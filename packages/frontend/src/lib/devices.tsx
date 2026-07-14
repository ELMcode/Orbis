import {
  Router,
  Server,
  ShieldCheck,
  Network,
  HardDrive,
  Database,
  Zap,
  BatteryCharging,
  Wifi,
  Scale,
  Cloud,
  Globe,
  Box,
  CircuitBoard,
  HelpCircle,
  Monitor,
  Printer,
  Camera,
  Radio,
  Cable,
  Phone,
  Cpu,
  Factory,
  type LucideIcon,
} from 'lucide-react';
import type { DeviceStatus, DeviceType, PortType } from '@/types';
import type { Language } from '@/hooks/useLanguage';

export const DEVICE_TYPES: Record<DeviceType, { label: string; icon: LucideIcon; color: string }> =
  {
    SWITCH: { label: 'Switch', icon: Network, color: '#3b82f6' },
    ROUTER: { label: 'Routeur', icon: Router, color: '#8b5cf6' },
    FIREWALL: { label: 'Pare-feu', icon: ShieldCheck, color: '#ef4444' },
    SERVER: { label: 'Serveur', icon: Server, color: '#10b981' },
    HYPERVISOR: { label: 'Hyperviseur', icon: Server, color: '#059669' },
    WORKSTATION: { label: 'Poste client', icon: Monitor, color: '#0f766e' },
    PRINTER: { label: 'Imprimante', icon: Printer, color: '#78716c' },
    CAMERA: { label: 'Caméra IP', icon: Camera, color: '#dc2626' },
    CONTROLLER: { label: 'Contrôleur', icon: Radio, color: '#7c3aed' },
    PATCH_PANEL: { label: 'Panneau de brassage', icon: Cable, color: '#475569' },
    MODEM: { label: 'Modem', icon: Radio, color: '#0891b2' },
    PHONE: { label: 'Téléphone IP', icon: Phone, color: '#16a34a' },
    IOT: { label: 'IoT', icon: Cpu, color: '#ca8a04' },
    OT: { label: 'OT / industriel', icon: Factory, color: '#ea580c' },
    NAS: { label: 'NAS', icon: HardDrive, color: '#f59e0b' },
    SAN: { label: 'SAN', icon: Database, color: '#06b6d4' },
    PDU: { label: 'PDU', icon: Zap, color: '#eab308' },
    UPS: { label: 'Onduleur', icon: BatteryCharging, color: '#84cc16' },
    ACCESS_POINT: { label: "Point d'accès", icon: Wifi, color: '#ec4899' },
    LOAD_BALANCER: { label: 'Load balancer', icon: Scale, color: '#a855f7' },
    INTERNET: { label: 'Internet', icon: Globe, color: '#0ea5e9' },
    CLOUD: { label: 'Cloud', icon: Cloud, color: '#6366f1' },
    VM: { label: 'Machine virtuelle', icon: Box, color: '#14b8a6' },
    RACK: { label: 'Baie', icon: CircuitBoard, color: '#64748b' },
    OTHER: { label: 'Autre', icon: HelpCircle, color: '#71717a' },
  };

export const DEVICE_STATUSES: Record<DeviceStatus, { label: string; color: string; dot: string }> =
  {
    ONLINE: { label: 'En ligne', color: 'text-status-online', dot: 'bg-status-online' },
    WARNING: { label: 'Avertissement', color: 'text-status-warning', dot: 'bg-status-warning' },
    OFFLINE: { label: 'Hors ligne', color: 'text-status-offline', dot: 'bg-status-offline' },
    MAINTENANCE: {
      label: 'Maintenance',
      color: 'text-status-maintenance',
      dot: 'bg-status-maintenance',
    },
    UNKNOWN: { label: 'Inconnu', color: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  };

export const PORT_TYPES: Record<PortType, { label: string; color: string }> = {
  ETHERNET: { label: 'Ethernet', color: '#3b82f6' },
  FIBER: { label: 'Fibre', color: '#06b6d4' },
  SFP: { label: 'SFP', color: '#8b5cf6' },
  SFP_PLUS: { label: 'SFP+ (10G)', color: '#a855f7' },
  QSFP: { label: 'QSFP (40G+)', color: '#ec4899' },
  CONSOLE: { label: 'Console', color: '#64748b' },
  USB: { label: 'USB', color: '#10b981' },
  POWER: { label: 'Alimentation', color: '#eab308' },
  OTHER: { label: 'Autre', color: '#71717a' },
};

export const DEVICE_TYPE_LIST = Object.entries(DEVICE_TYPES).map(([value, { label }]) => ({
  value: value as DeviceType,
  label,
}));

export const DEVICE_STATUS_LIST = Object.entries(DEVICE_STATUSES).map(([value, { label }]) => ({
  value: value as DeviceStatus,
  label,
}));

export const PORT_TYPE_LIST = Object.entries(PORT_TYPES).map(([value, { label }]) => ({
  value: value as PortType,
  label,
}));

const DEVICE_TYPE_LABELS_EN: Partial<Record<DeviceType, string>> = {
  SWITCH: 'Switch',
  ROUTER: 'Router',
  FIREWALL: 'Firewall',
  SERVER: 'Server',
  HYPERVISOR: 'Hypervisor',
  WORKSTATION: 'Workstation',
  PRINTER: 'Printer',
  CAMERA: 'IP camera',
  CONTROLLER: 'Controller',
  PATCH_PANEL: 'Patch panel',
  MODEM: 'Modem',
  PHONE: 'IP phone',
  IOT: 'IoT',
  OT: 'OT / industrial',
  NAS: 'NAS',
  SAN: 'SAN',
  PDU: 'PDU',
  UPS: 'UPS',
  ACCESS_POINT: 'Access point',
  LOAD_BALANCER: 'Load balancer',
  INTERNET: 'Internet',
  CLOUD: 'Cloud',
  VM: 'Virtual machine',
  RACK: 'Rack',
  OTHER: 'Other',
};

const DEVICE_STATUS_LABELS_EN: Record<DeviceStatus, string> = {
  ONLINE: 'Online',
  WARNING: 'Warning',
  OFFLINE: 'Offline',
  MAINTENANCE: 'Maintenance',
  UNKNOWN: 'Unknown',
};

export function deviceTypeLabel(type: DeviceType, language: Language) {
  return language === 'en'
    ? (DEVICE_TYPE_LABELS_EN[type] ?? DEVICE_TYPES[type].label)
    : DEVICE_TYPES[type].label;
}

export function deviceStatusLabel(status: DeviceStatus, language: Language) {
  return language === 'en' ? DEVICE_STATUS_LABELS_EN[status] : DEVICE_STATUSES[status].label;
}
