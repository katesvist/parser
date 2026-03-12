import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

export type OnboardingProfile = {
  company_name?: string;
  company_inn?: string;
  company_kpp?: string;
  company_ogrn?: string;
  industry?: string;
  region?: string;
  okved?: string;
  keywords?: string;
  company_description?: string;
};

interface OnboardingModalProps {
  open: boolean;
  initial: OnboardingProfile;
  isSaving: boolean;
  onSave: (payload: OnboardingProfile) => void;
  onClose?: () => void;
}

export function OnboardingModal({ open, initial, isSaving, onSave, onClose }: OnboardingModalProps) {
  const [form, setForm] = useState<OnboardingProfile>(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const updateField = (key: keyof OnboardingProfile, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(form);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose?.();
        }
      }}
    >
        <DialogContent
        className="sm:max-w-3xl rounded-[24px] border border-border bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="gap-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            Первый вход
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-xl">Добро пожаловать! Заполним профиль компании</DialogTitle>
            <DialogDescription>
              Это займёт пару минут и поможет точнее подбирать тендеры. Можно заполнить частично и позже отредактировать в профиле.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 rounded-[18px] border border-border/70 bg-white p-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Наименование</label>
            <Input
              value={form.company_name || ''}
              onChange={(e) => updateField('company_name', e.target.value)}
              placeholder="ООО «Компания»"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Отрасль</label>
            <Input
              value={form.industry || ''}
              onChange={(e) => updateField('industry', e.target.value)}
              placeholder="Строительство, ИТ…"
            />
          </div>
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">ИНН</label>
              <Input
                value={form.company_inn || ''}
                onChange={(e) => updateField('company_inn', e.target.value)}
                placeholder="7701234567"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">КПП</label>
              <Input
                value={form.company_kpp || ''}
                onChange={(e) => updateField('company_kpp', e.target.value)}
                placeholder="770101001"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">ОКВЭД</label>
              <Input
                value={form.okved || ''}
                onChange={(e) => updateField('okved', e.target.value)}
                placeholder="42.11, 62.01"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">ОГРН</label>
            <Input
              value={form.company_ogrn || ''}
              onChange={(e) => updateField('company_ogrn', e.target.value)}
              placeholder="1027700123456"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Регион работы</label>
            <Input
              value={form.region || ''}
              onChange={(e) => updateField('region', e.target.value)}
              placeholder="Москва, ЦФО"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-muted-foreground">Ключевые направления</label>
            <Textarea
              value={form.keywords || ''}
              onChange={(e) => updateField('keywords', e.target.value)}
              placeholder="Например: вентиляция, медоборудование"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-muted-foreground">Описание компании</label>
            <Textarea
              value={form.company_description || ''}
              onChange={(e) => updateField('company_description', e.target.value)}
              placeholder="Коротко о деятельности"
            />
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
            {isSaving ? 'Сохраняем...' : 'Сохранить и продолжить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
