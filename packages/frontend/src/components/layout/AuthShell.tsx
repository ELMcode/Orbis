import { type ReactNode } from 'react';
import { Database, Radar, ShieldCheck } from 'lucide-react';
import { OrbisMark } from '@/components/layout/OrbisMark';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { useLanguage } from '@/hooks/useLanguage';

const FEATURE_ICONS = [Database, Radar, ShieldCheck] as const;

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const features = [t.auth.features.source, t.auth.features.discovery, t.auth.features.operations];

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* ─── Left panel ───────────────────────────────── */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-12 lg:flex">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 30%, rgba(59,130,246,0.4), transparent 45%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.35), transparent 45%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        <div className="relative z-10 flex items-center gap-3 text-white">
          <OrbisMark className="h-11 w-11" />
          <span className="text-xl font-semibold tracking-tight">Orbis</span>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="max-w-xl text-4xl font-bold leading-tight text-white">
              {t.auth.sourceTruth}
            </h1>
            <p className="mt-4 max-w-md text-slate-300">{t.auth.description}</p>
          </div>

          <div className="space-y-3">
            {features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index];
              return (
                <div key={feature.title} className="flex items-start gap-3 text-white/90">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 backdrop-blur">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">{feature.title}</p>
                    <p className="text-sm text-slate-300">{feature.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="relative z-10 text-xs text-slate-400">
          © {new Date().getFullYear()} Orbis — {t.auth.footer}
        </p>
      </div>

      {/* ─── Right panel ──────────────────────────────── */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="relative w-full max-w-sm">
          <div className="mb-4 flex justify-end lg:absolute lg:-top-12 lg:right-0">
            <LanguageSwitcher />
          </div>
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <OrbisMark className="h-10 w-10" />
              <span className="text-lg font-semibold">Orbis</span>
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
