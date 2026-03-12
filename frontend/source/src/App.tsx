import { useEffect, useMemo, useState } from 'react';
import { Wrench, Send, MessageCircleMore, LogOut } from 'lucide-react';
import { LoginPage } from './components/LoginPage';
import { Dashboard } from './components/Dashboard';
import { TenderSearch } from './components/TenderSearch';
import { TenderDetails } from './components/TenderDetails';
import { ProfilePage } from './components/ProfilePage';
import { SavedSearches } from './components/SavedSearches';
import { KanbanBoard } from './components/KanbanBoard';
import { Favorites } from './components/Favorites';
import { Header } from './components/Header';
import { PageSection } from './components/PageSection';
import { OnboardingModal, type OnboardingProfile } from './components/OnboardingModal';
import { clearSession, isSessionValid, loadSession } from './lib/auth';
import { apiRequest } from './lib/api';

type Page = 'login' | 'dashboard' | 'search' | 'details' | 'kanban' | 'profile' | 'saved-searches' | 'favorites';

function extractFirstName(fullName: string) {
  const normalized = (fullName || '').trim();
  if (!normalized) return 'Пользователь';
  return normalized.split(/\s+/)[0] || normalized;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('Пользователь');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingInitial, setOnboardingInitial] = useState<OnboardingProfile>({});

  const firstName = useMemo(() => extractFirstName(profileName), [profileName]);

  const readPageFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const page = params.get('page') as Page | null;
    const tenderId = params.get('tender') || null;
    if (page && ['dashboard', 'search', 'details', 'kanban', 'profile', 'saved-searches', 'favorites'].includes(page)) {
      return { page, tenderId };
    }
    return { page: 'dashboard' as Page, tenderId: null };
  };

  const syncUrl = (page: Page, tenderId?: string | null, replace = false) => {
    const params = new URLSearchParams();
    if (page && page !== 'dashboard') {
      params.set('page', page);
    }
    if (page === 'details' && tenderId) {
      params.set('tender', tenderId);
    }
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    if (replace) {
      window.history.replaceState({ page, tenderId: tenderId || null }, '', next);
    } else {
      window.history.pushState({ page, tenderId: tenderId || null }, '', next);
    }
  };

  useEffect(() => {
    const session = loadSession();
    const hasSession = isSessionValid(session);
    setIsAuthenticated(hasSession);
    if (hasSession) {
      const { page, tenderId } = readPageFromUrl();
      setCurrentPage(page);
      setSelectedTenderId(tenderId);
    } else {
      setCurrentPage('login');
      setSelectedTenderId(null);
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    const handleAuthChange = () => {
      const session = loadSession();
      const hasSession = isSessionValid(session);
      setIsAuthenticated(hasSession);
      if (!hasSession) {
        setCurrentPage('login');
        setSelectedTenderId(null);
        syncUrl('login', null, true);
      }
    };
    window.addEventListener('parser-auth-changed', handleAuthChange);
    return () => window.removeEventListener('parser-auth-changed', handleAuthChange);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (!isAuthenticated) return;
      const { page, tenderId } = readPageFromUrl();
      setCurrentPage(page);
      setSelectedTenderId(tenderId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    const loadProfile = async () => {
      try {
        const profile = await apiRequest<
          { is_onboarded?: boolean; user_name?: string; email?: string } & OnboardingProfile
        >('profile');
        if (!isMounted) return;
        setOnboardingInitial(profile);
        setOnboardingOpen(!profile.is_onboarded);
        const nextName = profile.user_name?.trim() || profile.email?.trim() || 'Пользователь';
        setProfileName(nextName);
      } catch (err) {
        console.warn('Failed to load profile for onboarding', err);
      }
    };
    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  const handleLogin = () => {
    setIsAuthenticated(true);
    const { page, tenderId } = readPageFromUrl();
    setCurrentPage(page);
    setSelectedTenderId(tenderId);
    syncUrl(page, tenderId, true);
  };

  const handleLogout = async () => {
    clearSession();
    setIsAuthenticated(false);
    setCurrentPage('login');
    setSelectedTenderId(null);
    setProfileName('Пользователь');
    setOnboardingOpen(false);
    setOnboardingInitial({});
    syncUrl('login', null, true);
  };

  const handleNavigate = (page: Page, tenderId?: string) => {
    setCurrentPage(page);
    setSelectedTenderId(tenderId || null);
    syncUrl(page, tenderId || null);
  };

  const renderPageContent = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} />;
      case 'search':
        return <TenderSearch onNavigate={handleNavigate} />;
      case 'details':
        return selectedTenderId ? (
          <TenderDetails tenderId={selectedTenderId} onNavigate={handleNavigate} />
        ) : (
          <TenderSearch onNavigate={handleNavigate} />
        );
      case 'kanban':
        return <KanbanBoard onNavigate={handleNavigate} />;
      case 'profile':
        return <ProfilePage />;
      case 'saved-searches':
        return <SavedSearches onNavigate={handleNavigate} />;
      case 'favorites':
        return <Favorites onNavigate={handleNavigate} />;
      default:
        return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="md:flex md:min-h-screen">
      <Header
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        currentPage={currentPage}
        userName={profileName}
      />

      <div className="min-w-0 flex-1 px-4 pb-6 pt-4 md:px-5 md:pb-8 md:pt-6">
        <div className="mb-5 flex flex-col gap-3 md:mb-6 md:flex-row md:items-center md:justify-between">
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-[#1d202c] md:text-[28px]">
            Здравствуйте, <span className="text-[#ef4d1f]">{firstName}</span>!
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleNavigate('profile')}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#c8d0db] bg-white px-4 text-[14px] text-[#464d58]"
            >
              <Wrench className="h-4 w-4" />
              Настройки аккаунта
            </button>
            <button type="button" className="social-btn social-btn--vk" aria-label="VK">
              vk
            </button>
            <button type="button" className="social-btn social-btn--tg" aria-label="Telegram">
              <Send className="h-4 w-4" />
            </button>
            <button type="button" className="social-btn social-btn--chat" aria-label="Chat">
              <MessageCircleMore className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#d0d6df] bg-white px-4 text-[14px] text-[#525b67] hover:bg-[#f7f9fc]"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>

        <PageSection className="w-full">{renderPageContent()}</PageSection>
      </div>

      <OnboardingModal
        open={onboardingOpen}
        initial={onboardingInitial}
        isSaving={onboardingLoading}
        onClose={() => setOnboardingOpen(false)}
        onSave={async (payload) => {
          setOnboardingLoading(true);
          try {
            await apiRequest('profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, is_onboarded: true }),
            });
            setOnboardingOpen(false);
          } catch {
            window.alert('Не удалось сохранить данные организации.');
          } finally {
            setOnboardingLoading(false);
          }
        }}
      />
    </div>
  );
}
