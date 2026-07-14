# ─────────────────────────────────────────────────────────────
# Orbis Collector — VM Appliance (Packer + QEMU + cloud-init)
#
# Builds a bootable VM image (Debian 12) with the collector preinstalled
# and configured as a systemd service. Output: qcow2 (Proxmox/KVM).
# Convert to OVA (VMware) and VHDX (Hyper-V) with qemu-img (see README).
#
# Prerequisites:
#   - Packer >= 1.10  (brew install hashicorp/tap/packer)
#   - QEMU            (brew install qemu)
#   - Build the collector: cd packages/collector && pnpm run build
#
# Build :
#   cd deploy/collector/appliance
#   packer build -var version=1.1.0 packer.pkr.hcl
#
# Output : output/orbis-collector-<version>.qcow2
# ─────────────────────────────────────────────────────────────

packer {
  required_plugins {
    qemu = {
      version = ">= 1.1.0"
      source  = "github.com/hashicorp/qemu"
    }
  }
}

variable "version" {
  type    = string
  default = "1.1.0"
}

variable "debian_image_url" {
  type    = string
  default = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2"
}

variable "disk_size_mb" {
  type    = number
  default = 4096
}

variable "memory_mb" {
  type    = number
  default = 1024
}

variable "cpus" {
  type    = number
  default = 2
}

variable "build_ssh_password" {
  type      = string
  sensitive = true
  default   = "orbis-build-only"
}

source "qemu" "collector_appliance" {
  vm_name          = "orbis-collector-${var.version}.qcow2"
  output_directory = "output"

  # Image Debian 12 cloud (cloud-init ready)
  iso_url      = var.debian_image_url
  iso_checksum = "file:https://cloud.debian.org/images/cloud/bookworm/latest/SHA512SUMS"
  disk_image   = true

  # Config disque
  disk_size       = var.disk_size_mb
  disk_compression = true
  format          = "qcow2"

  # Config VM
  memory = var.memory_mb
  cpus   = var.cpus
  headless = true

  # Bootstrap cloud-init used only by Packer. The password is locked before
  # export, so customers must supply their own first-boot cloud-init identity.
  use_backing_file = true
  cd_label = "cidata"
  cd_content = {
    "meta-data" = "instance-id: orbis-packer-build\\nlocal-hostname: orbis-packer"
    "user-data" = <<-EOF
      #cloud-config
      users:
        - default
      chpasswd:
        expire: false
        list: |
          debian:${var.build_ssh_password}
      ssh_pwauth: true
    EOF
  }

  communicator = "ssh"
  ssh_username  = "debian"
  ssh_password  = var.build_ssh_password
  ssh_timeout   = "20m"
  ssh_handshake_attempts = 100
}

build {
  name    = "orbis-collector-appliance"
  sources = ["source.qemu.collector_appliance"]

  # ─── Provision : Node.js + collector + systemd ───────────
  provisioner "shell" {
    inline = [
      "sudo apt-get update",
      "sudo apt-get install -y curl ca-certificates",
      # Node.js 22 (NodeSource). Cloud SDK dependencies require Node 22+.
      "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -",
      "sudo apt-get install -y nodejs",
      # Directories
      "sudo mkdir -p /opt/orbis-collector",
      "sudo chown debian:debian /opt/orbis-collector",
    ]
  }

  # Copy the built collector (dist + production node_modules).
  provisioner "file" {
    source      = "../../../packages/collector/dist"
    destination = "/tmp/collector-dist"
  }
  provisioner "file" {
    source      = "../../../packages/collector/package.json"
    destination = "/tmp/collector-package.json"
  }

  provisioner "shell" {
    inline = [
      # Install production dependencies.
      "cd /opt/orbis-collector",
      "cp /tmp/collector-package.json ./package.json",
      "cp -r /tmp/collector-dist ./dist",
      "npm install --omit=dev --ignore-scripts",
      # Create the system user.
      "sudo useradd -r -s /usr/sbin/nologin orbis || true",
      "sudo chown -R orbis:orbis /opt/orbis-collector",
      # Configuration template
      "sudo mkdir -p /etc/orbis",
      "echo 'ORBIS_API_URL=' | sudo tee /etc/orbis/collector.env",
      "echo 'ORBIS_COLLECTOR_ID=' | sudo tee -a /etc/orbis/collector.env",
      "echo 'ORBIS_COLLECTOR_TOKEN=' | sudo tee -a /etc/orbis/collector.env",
      "echo 'ORBIS_CIDRS=' | sudo tee -a /etc/orbis/collector.env",
      "sudo chmod 600 /etc/orbis/collector.env",
    ]
  }

  # systemd service
  provisioner "file" {
    source      = "../linux/orbis-collector.service"
    destination = "/tmp/orbis-collector.service"
  }
  provisioner "shell" {
    inline = [
      "sudo mv /tmp/orbis-collector.service /etc/systemd/system/orbis-collector.service",
      # Adapt WorkingDirectory and ExecStart to the installation path.
      "sudo sed -i 's|ExecStart=.*|ExecStart=/usr/bin/node /opt/orbis-collector/dist/index.js|' /etc/systemd/system/orbis-collector.service",
      "sudo sed -i 's|WorkingDirectory=.*|WorkingDirectory=/opt/orbis-collector|' /etc/systemd/system/orbis-collector.service",
      "sudo sed -i 's|EnvironmentFile=.*|EnvironmentFile=/etc/orbis/collector.env|' /etc/systemd/system/orbis-collector.service",
      "sudo sed -i 's|^User=.*|User=orbis|' /etc/systemd/system/orbis-collector.service",
      "sudo sed -i 's|^Group=.*|Group=orbis|' /etc/systemd/system/orbis-collector.service",
      "sudo systemctl daemon-reload",
      "sudo systemctl enable orbis-collector",
    ]
  }

  # ─── Cleanup: reduce image size ─────────────────────────
  provisioner "shell" {
    inline = [
      "sudo apt-get clean",
      "sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*",
      "sudo truncate -s 0 /var/log/*.log /var/log/syslog || true",
      "sudo passwd -l debian",
      "sudo cloud-init clean --logs", # reset for the customer's first boot
    ]
  }

  # ─── Post-process: multi-format conversion ───────────────
  # Note: qemu-img must be installed on the build runner.
  post-processor "shell-local" {
    inline = [
      "echo '━━━ Appliance construite ━━━'",
      "echo 'qcow2 (Proxmox/KVM) : output/orbis-collector-${var.version}.qcow2'",
      "echo ''",
      "echo 'Conversion vers autres formats (nécessite qemu-img) :'",
      "echo '  # VMware OVA'",
      "echo '  qemu-img convert -f qcow2 -O vmdk output/orbis-collector-${var.version}.qcow2 output/orbis-collector-${var.version}.vmdk'",
      "echo '  # Hyper-V VHDX'",
      "echo '  qemu-img convert -f qcow2 -O vhdx output/orbis-collector-${var.version}.qcow2 output/orbis-collector-${var.version}.vhdx'",
    ]
  }
}
