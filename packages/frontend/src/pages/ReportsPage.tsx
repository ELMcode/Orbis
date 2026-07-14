import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Clock,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  Mail,
  PauseCircle,
  PlayCircle,
  Trash2,
  Send,
} from 'lucide-react';
import { api, ApiError, downloadAuthenticated } from '@/lib/api';
import type { ReportFormat, ReportFrequency, ReportSchedule, ReportType } from '@/types';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Empty';
import { FullLoading } from '@/components/ui/Loading';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';
import { localized, useLanguage } from '@/hooks/useLanguage';

const TYPE_LABELS: Record<ReportType, string> = {
  INVENTORY: 'Inventaire',
  IPAM: 'IPAM',
  CHANGES: 'Changements',
  TOPOLOGY: 'Topologie',
  AVAILABILITY: 'Disponibilité',
  RISKS: 'Risques',
  CAPACITY: 'Capacité',
};
const TYPE_LABELS_EN: Record<ReportType, string> = {
  INVENTORY: 'Inventory',
  IPAM: 'IPAM',
  CHANGES: 'Changes',
  TOPOLOGY: 'Topology',
  AVAILABILITY: 'Availability',
  RISKS: 'Risks',
  CAPACITY: 'Capacity',
};

const FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  WEEKLY: 'Hebdomadaire',
  MONTHLY: 'Mensuel',
  QUARTERLY: 'Trimestriel',
};
const FREQUENCY_LABELS_EN: Record<ReportFrequency, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
};

const WEEKDAYS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
];
const WEEKDAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TIMEZONES = [
  'Europe/Paris',
  'Europe/London',
  'UTC',
  'America/New_York',
  'America/Toronto',
  'Asia/Dubai',
];

const EXPORTS = [
  {
    label: 'Inventaire CSV',
    path: '/api/reports/exports/inventory.csv',
    file: 'inventaire.csv',
    icon: FileSpreadsheet,
  },
  {
    label: 'IPAM CSV',
    path: '/api/reports/exports/ipam.csv',
    file: 'ipam.csv',
    icon: FileSpreadsheet,
  },
  {
    label: 'Changements CSV',
    path: '/api/reports/exports/changes.csv',
    file: 'changements.csv',
    icon: FileSpreadsheet,
  },
  {
    label: 'Inventaire PDF',
    path: '/api/reports/exports/inventory.pdf',
    file: 'inventaire.pdf',
    icon: FileText,
  },
  {
    label: 'Topologie PDF',
    path: '/api/reports/exports/topology.pdf',
    file: 'topologie.pdf',
    icon: FileBarChart2,
  },
  {
    label: 'Disponibilité PDF',
    path: '/api/reports/exports/availability.pdf',
    file: 'disponibilite.pdf',
    icon: FileBarChart2,
  },
  {
    label: 'Risques PDF',
    path: '/api/reports/exports/risks.pdf',
    file: 'risques.pdf',
    icon: FileBarChart2,
  },
  {
    label: 'Capacité PDF',
    path: '/api/reports/exports/capacity.pdf',
    file: 'capacite.pdf',
    icon: FileBarChart2,
  },
];

const INITIAL_FORM = {
  name: 'Rapport mensuel inventaire',
  type: 'INVENTORY' as ReportType,
  format: 'PDF' as ReportFormat,
  frequency: 'MONTHLY' as ReportFrequency,
  startAt: defaultStartAt(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
  scheduledHour: 8,
  scheduledMinute: 0,
  scheduledWeekday: 1,
  scheduledMonthDay: 1,
  recipients: '',
  siteId: '',
  active: true,
};

export default function ReportsPage() {
  const { t, language } = useLanguage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { canEdit } = useAuth();
  const [form, setForm] = useState({
    ...INITIAL_FORM,
    name: language === 'fr' ? INITIAL_FORM.name : 'Monthly inventory report',
  });

  const schedulesQuery = useQuery({
    queryKey: ['report-schedules'],
    queryFn: api.reports.schedules,
  });
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: api.sites.list });

  const recipients = useMemo(() => parseRecipients(form.recipients), [form.recipients]);
  const canWrite = canEdit;

  const createSchedule = useMutation({
    mutationFn: () =>
      api.reports.createSchedule({
        name: form.name,
        type: form.type,
        format: form.format,
        frequency: form.frequency,
        recipients,
        siteId: form.siteId || null,
        active: form.active,
        timezone: form.timezone,
        scheduledHour: Number(form.scheduledHour),
        scheduledMinute: Number(form.scheduledMinute),
        scheduledWeekday: form.frequency === 'WEEKLY' ? Number(form.scheduledWeekday) : null,
        scheduledMonthDay:
          form.frequency === 'MONTHLY' || form.frequency === 'QUARTERLY'
            ? Number(form.scheduledMonthDay)
            : null,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
      setForm({
        ...INITIAL_FORM,
        name: language === 'fr' ? INITIAL_FORM.name : 'Monthly inventory report',
      });
      toast.success(t.reports.created);
    },
    onError: (err) =>
      toast.error(t.reports.createFailed, err instanceof ApiError ? err.message : undefined),
  });

  const toggleSchedule = useMutation({
    mutationFn: (schedule: ReportSchedule) =>
      api.reports.updateSchedule(schedule.id, { active: !schedule.active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
      toast.success(t.reports.updated);
    },
    onError: (err) =>
      toast.error(t.reports.updateFailed, err instanceof ApiError ? err.message : undefined),
  });

  const removeSchedule = useMutation({
    mutationFn: (id: string) => api.reports.removeSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
      toast.success(t.reports.deleted);
    },
    onError: (err) =>
      toast.error(t.reports.deleteFailed, err instanceof ApiError ? err.message : undefined),
  });

  const testSchedule = useMutation({
    mutationFn: (id: string) => api.reports.testSchedule(id),
    onSuccess: (res) => {
      toast.success(res.delivered ? t.reports.emailSent : t.reports.smtpTest, res.message);
    },
    onError: (err) =>
      toast.error(t.reports.testFailed, err instanceof ApiError ? err.message : undefined),
  });

  if (
    schedulesQuery.isLoading ||
    sitesQuery.isLoading ||
    !schedulesQuery.data ||
    !sitesQuery.data
  ) {
    return (
      <PageContainer>
        <PageHeader title={t.reports.title} />
        <FullLoading />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t.reports.title}
        description={
          language === 'fr'
            ? 'Exports exploitables, rapports exécutifs et envois planifiés pour l’inventaire infrastructure.'
            : 'Actionable exports, executive reports and scheduled deliveries for infrastructure inventory.'
        }
      />

      <div className="mt-6 grid gap-6 px-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t.reports.immediateExports}</CardTitle>
            <CardDescription>{t.reports.immediateDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {EXPORTS.map((item) => (
                <Button
                  key={item.path}
                  variant="outline"
                  className="h-12 justify-start"
                  onClick={() =>
                    downloadAuthenticated(item.path, item.file).catch((err) =>
                      toast.error(
                        t.reports.downloadFailed,
                        err instanceof ApiError ? err.message : undefined,
                      ),
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span className="min-w-0 truncate">{item.label}</span>
                  <Download className="ml-auto h-4 w-4" />
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.reports.schedule}</CardTitle>
            <CardDescription>{t.reports.scheduleDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder={t.reports.reportName}
                disabled={!canWrite}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value as ReportType })}
                  disabled={!canWrite}
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {language === 'fr' ? label : TYPE_LABELS_EN[value as ReportType]}
                    </option>
                  ))}
                </Select>
                <Select
                  value={form.format}
                  onChange={(event) =>
                    setForm({ ...form, format: event.target.value as ReportFormat })
                  }
                  disabled={!canWrite}
                >
                  <option value="PDF">PDF</option>
                  <option value="CSV">CSV</option>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  value={form.frequency}
                  onChange={(event) =>
                    setForm({ ...form, frequency: event.target.value as ReportFrequency })
                  }
                  disabled={!canWrite}
                >
                  {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {language === 'fr' ? label : FREQUENCY_LABELS_EN[value as ReportFrequency]}
                    </option>
                  ))}
                </Select>
                <Select
                  value={form.siteId}
                  onChange={(event) => setForm({ ...form, siteId: event.target.value })}
                  disabled={!canWrite}
                >
                  <option value="">{t.reports.allSites}</option>
                  {sitesQuery.data.sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-primary" />
                  {localized(language, 'Calendrier d’envoi', 'Delivery schedule')}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t.reports.firstSend}>
                    <Input
                      type="datetime-local"
                      value={form.startAt}
                      onChange={(event) => setForm({ ...form, startAt: event.target.value })}
                      disabled={!canWrite}
                    />
                  </Field>
                  <Field label={t.reports.timezone}>
                    <Select
                      value={form.timezone}
                      onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                      disabled={!canWrite}
                    >
                      {TIMEZONES.map((timezone) => (
                        <option key={timezone} value={timezone}>
                          {timezone}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t.reports.sendTime}>
                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        value={String(form.scheduledHour)}
                        onChange={(event) =>
                          setForm({ ...form, scheduledHour: Number(event.target.value) })
                        }
                        disabled={!canWrite}
                      >
                        {Array.from({ length: 24 }, (_, hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, '0')} h
                          </option>
                        ))}
                      </Select>
                      <Select
                        value={String(form.scheduledMinute)}
                        onChange={(event) =>
                          setForm({ ...form, scheduledMinute: Number(event.target.value) })
                        }
                        disabled={!canWrite}
                      >
                        {[0, 15, 30, 45].map((minute) => (
                          <option key={minute} value={minute}>
                            {String(minute).padStart(2, '0')}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </Field>
                  {form.frequency === 'WEEKLY' && (
                    <Field label={t.reports.sendDay}>
                      <Select
                        value={String(form.scheduledWeekday)}
                        onChange={(event) =>
                          setForm({ ...form, scheduledWeekday: Number(event.target.value) })
                        }
                        disabled={!canWrite}
                      >
                        {WEEKDAYS.map((day) => (
                          <option key={day.value} value={day.value}>
                            {language === 'fr' ? day.label : WEEKDAYS_EN[day.value - 1]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {(form.frequency === 'MONTHLY' || form.frequency === 'QUARTERLY') && (
                    <Field
                      label={
                        form.frequency === 'MONTHLY' ? t.reports.monthDay : t.reports.quarterDay
                      }
                    >
                      <Select
                        value={String(form.scheduledMonthDay)}
                        onChange={(event) =>
                          setForm({ ...form, scheduledMonthDay: Number(event.target.value) })
                        }
                        disabled={!canWrite}
                      >
                        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {scheduleSummary(form, language)}
                </p>
              </div>
              <Textarea
                value={form.recipients}
                onChange={(event) => setForm({ ...form, recipients: event.target.value })}
                placeholder="destinataire@entreprise.com, autre@entreprise.com"
                disabled={!canWrite}
              />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  disabled={!canWrite}
                />
                {localized(
                  language,
                  'Activer la planification dès la création',
                  'Enable scheduling on creation',
                )}
              </label>
              <Button
                onClick={() => createSchedule.mutate()}
                disabled={
                  !canWrite ||
                  createSchedule.isPending ||
                  !form.name.trim() ||
                  recipients.length === 0
                }
                className="w-full"
              >
                <CalendarClock className="h-4 w-4" />
                {createSchedule.isPending
                  ? localized(language, 'Création...', 'Creating...')
                  : localized(language, 'Créer la planification', 'Create schedule')}
              </Button>
              {!canWrite && <p className="text-xs text-muted-foreground">{t.reports.readOnly}</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 px-6">
        <Card>
          <CardHeader>
            <CardTitle>{t.reports.scheduled}</CardTitle>
            <CardDescription>{t.reports.scheduledDescription}</CardDescription>
          </CardHeader>
          <div className="divide-y">
            {schedulesQuery.data.schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">{schedule.name}</h2>
                    <Badge variant={schedule.active ? 'success' : 'muted'}>
                      {schedule.active
                        ? localized(language, 'Actif', 'Active')
                        : localized(language, 'Pause', 'Paused')}
                    </Badge>
                    <Badge variant="outline">
                      {(language === 'fr' ? TYPE_LABELS : TYPE_LABELS_EN)[schedule.type]} ·{' '}
                      {schedule.format}
                    </Badge>
                    <Badge variant="outline">
                      {
                        (language === 'fr' ? FREQUENCY_LABELS : FREQUENCY_LABELS_EN)[
                          schedule.frequency
                        ]
                      }
                    </Badge>
                    {schedule.site && <Badge variant="muted">{schedule.site.name}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <Mail className="mr-1 inline h-3.5 w-3.5" />
                    {schedule.recipients.join(', ') ||
                      localized(language, 'Aucun destinataire', 'No recipients')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {localized(language, 'Prochain envoi', 'Next delivery')}:{' '}
                    {formatDate(schedule.nextRunAt, language)} ·{' '}
                    {localized(language, 'Dernier envoi', 'Last delivery')}:{' '}
                    {formatDate(schedule.lastRunAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {localized(language, 'Rythme', 'Schedule')}:{' '}
                    {scheduleDetails(schedule, language)}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testSchedule.mutate(schedule.id)}
                      disabled={testSchedule.isPending || schedule.recipients.length === 0}
                    >
                      <Send className="h-4 w-4" /> {localized(language, 'Tester', 'Test')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleSchedule.mutate(schedule)}
                      disabled={toggleSchedule.isPending}
                    >
                      {schedule.active ? (
                        <PauseCircle className="h-4 w-4" />
                      ) : (
                        <PlayCircle className="h-4 w-4" />
                      )}
                      {schedule.active
                        ? localized(language, 'Pause', 'Pause')
                        : localized(language, 'Activer', 'Enable')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeSchedule.mutate(schedule.id)}
                      disabled={removeSchedule.isPending}
                    >
                      <Trash2 className="h-4 w-4" /> {localized(language, 'Supprimer', 'Delete')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {schedulesQuery.data.schedules.length === 0 && (
              <EmptyState
                icon={CalendarClock}
                title={t.reports.noScheduled}
                description={t.reports.noScheduledDescription}
              />
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}

function parseRecipients(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value: string | null | undefined, language: 'fr' | 'en' = 'fr') {
  if (!value) return language === 'fr' ? 'non planifié' : 'not scheduled';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function defaultStartAt() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(8, 0, 0, 0);
  return toDatetimeLocal(date);
}

function toDatetimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scheduleSummary(form: typeof INITIAL_FORM, language: 'fr' | 'en' = 'fr') {
  const first = form.startAt
    ? formatDate(new Date(form.startAt).toISOString(), language)
    : localized(language, 'à calculer', 'to be calculated');
  if (form.frequency === 'WEEKLY') {
    const weekday =
      (language === 'fr'
        ? WEEKDAYS.find((day) => day.value === Number(form.scheduledWeekday))?.label
        : WEEKDAYS_EN[Number(form.scheduledWeekday) - 1]
      )?.toLowerCase() ?? localized(language, 'jour choisi', 'selected day');
    return language === 'fr'
      ? `Premier envoi ${first}, puis chaque ${weekday} à ${timeLabel(form.scheduledHour, form.scheduledMinute)} (${form.timezone}).`
      : `First delivery ${first}, then every ${weekday} at ${timeLabel(form.scheduledHour, form.scheduledMinute)} (${form.timezone}).`;
  }
  if (form.frequency === 'QUARTERLY') {
    return language === 'fr'
      ? `Premier envoi ${first}, puis chaque trimestre le ${form.scheduledMonthDay} à ${timeLabel(form.scheduledHour, form.scheduledMinute)} (${form.timezone}).`
      : `First delivery ${first}, then every quarter on day ${form.scheduledMonthDay} at ${timeLabel(form.scheduledHour, form.scheduledMinute)} (${form.timezone}).`;
  }
  return language === 'fr'
    ? `Premier envoi ${first}, puis chaque mois le ${form.scheduledMonthDay} à ${timeLabel(form.scheduledHour, form.scheduledMinute)} (${form.timezone}).`
    : `First delivery ${first}, then every month on day ${form.scheduledMonthDay} at ${timeLabel(form.scheduledHour, form.scheduledMinute)} (${form.timezone}).`;
}

function scheduleDetails(schedule: ReportSchedule, language: 'fr' | 'en' = 'fr') {
  if (schedule.frequency === 'WEEKLY') {
    const weekday =
      (language === 'fr'
        ? WEEKDAYS.find((day) => day.value === schedule.scheduledWeekday)?.label
        : WEEKDAYS_EN[(schedule.scheduledWeekday ?? 1) - 1]
      )?.toLowerCase() ?? localized(language, 'jour choisi', 'selected day');
    return `${(language === 'fr' ? FREQUENCY_LABELS : FREQUENCY_LABELS_EN)[schedule.frequency]}, ${weekday}, ${timeLabel(schedule.scheduledHour, schedule.scheduledMinute)} (${schedule.timezone})`;
  }
  if (schedule.frequency === 'QUARTERLY') {
    return `${(language === 'fr' ? FREQUENCY_LABELS : FREQUENCY_LABELS_EN)[schedule.frequency]}, ${language === 'fr' ? 'jour' : 'day'} ${schedule.scheduledMonthDay ?? 1}, ${timeLabel(schedule.scheduledHour, schedule.scheduledMinute)} (${schedule.timezone})`;
  }
  return `${(language === 'fr' ? FREQUENCY_LABELS : FREQUENCY_LABELS_EN)[schedule.frequency]}, ${language === 'fr' ? 'jour' : 'day'} ${schedule.scheduledMonthDay ?? 1}, ${timeLabel(schedule.scheduledHour, schedule.scheduledMinute)} (${schedule.timezone})`;
}

function timeLabel(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
