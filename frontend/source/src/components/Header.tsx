import { Button } from './ui/button';
import { Avatar, AvatarFallback } from './ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { 
  FileText, 
  Search, 
  LayoutDashboard, 
  Star, 
  BookmarkCheck, 
  Columns3,
  User, 
  LogOut
} from 'lucide-react';
import { cn } from './ui/utils';

interface HeaderProps {
  onNavigate: (page: 'dashboard' | 'search' | 'kanban' | 'profile' | 'saved-searches' | 'favorites') => void;
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
  return parts
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export function Header({ onNavigate, onLogout, currentPage, userName }: HeaderProps) {
  const navItems = [
    { id: 'dashboard', label: 'Дашборд', icon: LayoutDashboard },
    { id: 'search', label: 'Поиск тендеров', icon: Search },
    { id: 'favorites', label: 'Избранное', icon: Star },
    { id: 'kanban', label: 'Канбан', icon: Columns3 },
    { id: 'saved-searches', label: 'Сохраненные поиски', icon: BookmarkCheck },
  ];
  const displayName = (userName || '').trim() || 'Пользователь';
  const initials = getInitials(displayName);

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-white">
      <div className="mx-auto flex h-[68px] w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-[0_12px_24px_-16px_rgba(31,60,136,0.6)]">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-[#0b1020] tracking-tight">Тендер.Поиск</span>
              <p className="text-xs text-muted-foreground">Внутренний стенд</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1.5 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() => onNavigate(item.id as any)}
                  aria-current={currentPage === item.id ? 'page' : undefined}
                  className={cn(
                    'gap-2 rounded-full px-4 text-sm font-medium transition-colors',
                    currentPage === item.id
                      ? 'bg-primary text-white shadow-sm hover:bg-primary/90 hover:text-white'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <Avatar className="w-8 h-8">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden md:inline">{displayName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Мой аккаунт</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onNavigate('profile')}>
                <User className="w-4 h-4 mr-2" />
                Профиль
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
