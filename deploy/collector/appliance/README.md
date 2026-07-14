# Orbis Collector — VM Appliance

Image VM bootable (Debian 12 + Node.js 22 + collector pré-installé en service systemd).
Déployable sur **Proxmox, VMware, Hyper-V, KVM**.

## Build

### Pré-requis
- [Packer](https://developer.hashicorp.com/packer/downloads) ≥ 1.10
- [QEMU](https://www.qemu.org/download/) (pour le builder + conversion de formats)
- Le collector doit être compilé : `cd packages/collector && pnpm install && pnpm run build`

### Construire l'image qcow2

```bash
cd deploy/collector/appliance
packer build -var version=1.1.0 packer.pkr.hcl
```

Output : `output/orbis-collector-1.1.0.qcow2`

Le build télécharge l'image officielle Debian 12 cloud, installe Node.js 20, copie le collector, crée le service systemd, et nettoie l'image.

### Convertir vers d'autres formats

Le builder produit du `qcow2` (Proxmox/KVM natif). Pour les autres plateformes :

```bash
# VMware (VMDK → puis convertir en OVA via ovftool, ou importer directement)
qemu-img convert -f qcow2 -O vmdk output/orbis-collector-1.1.0.qcow2 output/orbis-collector-1.1.0.vmdk

# Hyper-V (VHDX)
qemu-img convert -f qcow2 -O vhdx output/orbis-collector-1.1.0.qcow2 output/orbis-collector-1.1.0.vhdx

# OVA (VMware) — via ovftool
ovftool output/orbis-collector-1.1.0.vmdk output/orbis-collector-1.1.0.ova
```

## Configuration au premier boot (cloud-init)

L'appliance est configurable via **cloud-init**. Au premier démarrage, éditez les user-data de votre plateforme (Proxmox cloud-init, VMware vApp, Hyper-V, etc.) ou montez un seed ISO avec ces fichiers :

### user-data
```yaml
#cloud-config
write_files:
  - path: /etc/orbis/collector.env
    permissions: '0600'
    content: |
      ORBIS_API_URL=https://app.orbis.local/api
      ORBIS_COLLECTOR_ID=<votre-collector-id>
      ORBIS_COLLECTOR_TOKEN=<votre-token>
      ORBIS_CIDRS=192.168.1.0/24,10.0.0.0/24
      ORBIS_INTERVAL_SECONDS=900

runcmd:
  - systemctl restart orbis-collector
```

### Accès initial
L'image exportée ne contient aucun mot de passe de connexion utilisable. Créez
votre utilisateur administrateur et sa clé SSH dans le `user-data` cloud-init
de votre plateforme avant le premier démarrage. Le compte technique utilisé
pendant la construction est verrouillé avant l'export de l'image.

## Déploiement par plateforme

### Proxmox VE
```bash
qm create 200 --name orbis-collector --memory 1024 --cores 2 --net0 virtio,bridge=vmbr0
qm import disk 200 orbis-collector-1.1.0.qcow2 local-lvm
qm set 200 --scsihw virtio-scsi-pci --scsi0 local-lvm:vm-200-disk-0
qm set 200 --boot c --bootdisk scsi0
qm set 200 --agent 1
# Configurer cloud-init dans la GUI Proxmox
```

### VMware (ESXi/vCenter)
Importez le `.vmdk` via le datastore browser, créez une VM et attachez le disque.
Ou utilisez `ovftool` avec le `.ova`.

### Hyper-V
```powershell
Convert-VHD -Path .\orbis-collector-1.1.0.vhdx -VHDType Dynamic -DestinationPath .\collector.vhdx
New-VM -Name "Orbis Collector" -MemoryStartupBytes 1GB -Generation 2 -VHDPath .\collector.vhdx -SwitchName "Default Switch"
```

## Vérification

Après boot + config cloud-init :
```bash
# SSH vers la VM
ssh debian@<vm-ip>
# Vérifier le service
sudo systemctl status orbis-collector
# Voir les logs
sudo journalctl -u orbis-collector -f
```

## Désactivation de la génération auto de schéma

Le collector crée un schéma automatiquement après chaque découverte par défaut.
Pour désactiver : ajoutez `ORBIS_AUTO_DIAGRAM=false` dans le `collector.env`.
