import { Languages } from 'lucide-react';
import { useLanguage, type Language } from '@/hooks/useLanguage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/Dropdown';

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  const options: Array<{ value: Language; label: string }> = [
    { value: 'fr', label: t.french },
    { value: 'en', label: t.english },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t.language}
          aria-label={t.language}
        >
          <Languages className="h-4 w-4" />
          <span className="uppercase">{language}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>{t.language}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setLanguage(option.value)}
            className="justify-between"
          >
            {option.label}
            {language === option.value && <span aria-hidden="true">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
