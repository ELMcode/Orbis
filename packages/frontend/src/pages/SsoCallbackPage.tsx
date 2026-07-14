import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { storage } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { AuthShell } from '@/components/layout/AuthShell';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/hooks/useLanguage';

export default function SsoCallbackPage() {
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const { t, language } = useLanguage();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('accessToken');
    const organizationId = params.get('organizationId');
    if (!accessToken) {
      setError(
        language === 'fr'
          ? 'Retour SSO incomplet. Relancez la connexion depuis la page de login.'
          : 'Incomplete SSO response. Restart sign-in from the login page.',
      );
      return;
    }
    storage.setAccess(accessToken);
    if (organizationId) storage.setOrg(organizationId);
    window.history.replaceState(null, '', '/sso/callback');
    refreshMe()
      .then(() => navigate('/dashboard', { replace: true }))
      .catch(() => {
        storage.clear();
        setError(
          language === 'fr'
            ? 'Session SSO invalide ou expirée.'
            : 'SSO session is invalid or expired.',
        );
      });
  }, [navigate, refreshMe]);

  return (
    <AuthShell
      title={language === 'fr' ? 'Connexion SSO' : 'SSO sign-in'}
      subtitle={
        language === 'fr'
          ? 'Validation de la session entreprise'
          : 'Validating the enterprise session'
      }
    >
      {error ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            {t.auth.backToLogin}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {language === 'fr' ? 'Connexion en cours...' : 'Signing in...'}
        </div>
      )}
    </AuthShell>
  );
}
