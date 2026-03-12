import { useEffect, useState } from 'react';
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

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('Пользователь');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingInitial, setOnboardingInitial] = useState<OnboardingProfile>({});

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
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen text-foreground">
      <Header
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        currentPage={currentPage}
        userName={profileName}
      />

      <main className="py-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <PageSection className="w-full">{renderPageContent()}</PageSection>
        </div>
      </main>

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
          } catch (err) {
            window.alert('Не удалось сохранить данные организации.');
          } finally {
            setOnboardingLoading(false);
          }
        }}
      />
    </div>
  );
}
