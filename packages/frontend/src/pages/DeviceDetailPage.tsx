import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DeviceDrawer } from '@/components/canvas/DeviceDrawer';
import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

export default function DeviceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [open, setOpen] = useState(true);

  // Closing the drawer returns to the list.
  useEffect(() => {
    if (!open) navigate('/devices', { replace: true });
  }, [open, navigate]);

  return (
    <div className="flex h-full items-center justify-center bg-muted/20">
      <div className="text-center text-muted-foreground">
        <Button variant="ghost" onClick={() => navigate('/devices')} className="mb-4">
          <ArrowLeft className="h-4 w-4" />{' '}
          {language === 'fr' ? 'Retour à la liste' : 'Back to list'}
        </Button>
        <p className="text-sm">
          {language === 'fr' ? "Ouverture de l'équipement…" : 'Opening device…'}
        </p>
      </div>
      <DeviceDrawer deviceId={id ?? null} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
