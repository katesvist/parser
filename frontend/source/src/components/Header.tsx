import { Avatar, AvatarFallback } from './ui/avatar';
import { cn } from './ui/utils';
import {
  LayoutDashboard,
  Search,
  Star,
  Columns3,
  BookmarkCheck,
  Users,
  LineChart,
  FileText,
  LogOut,
} from 'lucide-react';

interface HeaderProps {
  onNavigate: (page: 'dashboard' | 'search' | 'kanban' | 'profile' | 'saved-searches' | 'favorites' | 'team') => void;
  onLogout: () => void;
  currentPage: string;
  userName?: string;
}

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return 'П';
  return parts.map((part) => part[0]?.toUpperCase() || '').join('');
}

const navItems = [
  { id: 'dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { id: 'search', label: 'Поиск тендеров', icon: Search },
  { id: 'favorites', label: 'Избранное', icon: Star },
  { id: 'kanban', label: 'Канбан', icon: Columns3 },
  { id: 'saved-searches', label: 'Сохраненные поиски', icon: BookmarkCheck },
  { id: 'team', label: 'Команда', icon: Users },
] as const;

const moduleItems = [
  { id: 'market', label: 'Анализ рынка', icon: LineChart },
  { id: 'docs', label: 'Документы', icon: FileText },
] as const;

export function Header({ onNavigate, onLogout, currentPage, userName }: HeaderProps) {
  const displayName = (userName || '').trim() || 'Пользователь';
  const initials = getInitials(displayName);

  return (
    <>
      <div className="hidden w-[223px] shrink-0 md:mb-3 md:ml-3 md:mt-3 md:block md:self-start">
        <aside className="sticky top-3 flex h-[calc(100vh-24px)] flex-col rounded-xl bg-[#cfd6de] p-3">
          <div className="mb-5 px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[10px] font-bold text-[#1d202c]">
                Tender
              </div>
              <div className="text-[24px] leading-6 font-extrabold tracking-tight text-[#1d202c]">Tender</div>
            </div>
          </div>

          <nav className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => !item.disabled && onNavigate(item.id as any)}
                  className={cn(
                    'flex h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[14px] transition-colors',
                    item.disabled
                      ? 'cursor-not-allowed text-[#7f8896]'
                      : isActive
                        ? 'bg-[#ecf0f3] text-[#1d202c]'
                        : 'text-[#333b47] hover:bg-[#e7ebf1]',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="my-5 border-t border-[#9da7b3]" />

          <div className="text-[16px] leading-5 font-bold text-[#333b47]">Модули</div>
          <div className="mt-3 space-y-1">
            {moduleItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled
                  className="flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[14px] text-[#8f959f]"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              disabled
              className="flex h-9 w-full items-center justify-between rounded-[10px] px-3 text-left text-[14px] text-[#333b47]"
            >
              <span>Добавить модуль</span>
              <span>⟲</span>
            </button>
          </div>

          <div className="mt-auto rounded-xl bg-[#c6ced8] px-3 py-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 bg-[#ef4d1f] text-white">
                <AvatarFallback className="bg-[#ef4d1f] text-white">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-[16px] leading-5 font-semibold text-[#1d202c]">{displayName}</div>
                <div className="text-[12px] leading-4 text-[#6f7887]">Free Plan</div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#b7c0cc] bg-[#d6dde6] text-[14px] font-semibold text-[#4e5663] hover:bg-[#dfe5ed]"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
        </aside>
      </div>

      <div className="sticky top-0 z-50 border-b border-[#dbe1ea] bg-[#f0f2f7] px-3 py-2 md:hidden">
        <div className="mb-2 text-[18px] font-extrabold text-[#1d202c]">Tender</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {navItems
            .filter((item) => !item.disabled)
            .map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id as any)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[14px]',
                    isActive
                      ? 'border-[#c9d4e0] bg-white text-[#1d202c]'
                      : 'border-transparent bg-transparent text-[#66707f]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="mt-2 inline-flex h-9 items-center gap-2 rounded-full border border-[#c9d4e0] bg-white px-3 text-[13px] text-[#4e5663]"
        >
          <LogOut className="h-3.5 w-3.5" />
          Выйти
        </button>
      </div>
    </>
  );
}
