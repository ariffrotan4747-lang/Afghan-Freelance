import React, { useState, useEffect } from 'react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MarketplaceProvider, useMarketplace } from './context/MarketplaceContext';

import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HesabPayModal } from './components/HesabPayModal';
import { ChatModal } from './components/ChatModal';
import { OfflineBanner } from './components/OfflineBanner';

// Pages
import { Home } from './pages/Home';
import { Services } from './pages/Services';
import { Freelancers } from './pages/Freelancers';
import { Projects } from './pages/Projects';
import { Categories } from './pages/Categories';
import { HowItWorks } from './pages/HowItWorks';
import { ClientDashboard } from './pages/ClientDashboard';
import { FreelancerDashboard } from './pages/FreelancerDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { WalletPage } from './pages/WalletPage';
import { SystemStatus } from './pages/SystemStatus';

import { Service, FreelancerProfile, Project } from './types';

const MainAppContent: React.FC = () => {
  const { dir } = useLanguage();
  const { role } = useAuth();
  const { placeOrder } = useMarketplace();

  // Navigation tab state
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategorySlug, setSelectedCategorySlug] = useState<string>('');

  // Active Chat State
  const [chatRecipient, setChatRecipient] = useState<{ id: string; name: string } | null>(null);

  // Service ordering from home/cards
  const handleSelectService = (service: Service) => {
    setCurrentTab('services');
  };

  const handleSelectFreelancer = (freelancer: FreelancerProfile) => {
    setCurrentTab('freelancers');
  };

  const handleSelectProject = (project: Project) => {
    setCurrentTab('projects');
  };

  const handleOpenChatWithFreelancer = (freelancer: FreelancerProfile) => {
    setChatRecipient({ id: freelancer.id, name: freelancer.name });
  };

  const handleOpenChatWithPerson = (id: string, name: string) => {
    setChatRecipient({ id, name });
  };

  const handleCategoryNav = (categoryId: string) => {
    setSelectedCategorySlug(categoryId);
    setCurrentTab('services');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white" dir={dir}>
      <OfflineBanner />

      {/* Header */}
      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        onOpenSearch={(query) => {
          setSearchQuery(query);
          setCurrentTab('services');
        }}
      />

      {/* Main Body Router */}
      <main className="flex-1">
        {currentTab === 'home' && (
          <Home
            setCurrentTab={setCurrentTab}
            onSelectService={handleSelectService}
            onSelectFreelancer={handleSelectFreelancer}
            onSelectProject={handleSelectProject}
            onOpenChatWith={handleOpenChatWithFreelancer}
            onSubmitProposal={() => setCurrentTab('projects')}
          />
        )}

        {currentTab === 'services' && (
          <Services
            initialSearchQuery={searchQuery}
            selectedCategorySlug={selectedCategorySlug}
            onOpenChatWithSeller={(id, name) => handleOpenChatWithPerson(id, name)}
          />
        )}

        {currentTab === 'freelancers' && (
          <Freelancers onOpenChatWith={handleOpenChatWithFreelancer} />
        )}

        {currentTab === 'projects' && <Projects />}

        {currentTab === 'categories' && (
          <Categories onSelectCategory={handleCategoryNav} />
        )}

        {currentTab === 'how-it-works' && <HowItWorks />}

        {currentTab === 'dashboard-client' && (
          <ClientDashboard
            onOpenChat={handleOpenChatWithPerson}
            onPostNewProject={() => setCurrentTab('projects')}
          />
        )}

        {currentTab === 'dashboard-freelancer' && (
          <FreelancerDashboard
            onOpenWallet={() => setCurrentTab('wallet')}
            onOpenChat={handleOpenChatWithPerson}
          />
        )}

        {currentTab === 'admin' && <AdminDashboard />}

        {currentTab === 'wallet' && <WalletPage />}

        {currentTab === 'system-status' && <SystemStatus />}
      </main>

      {/* Global HesabPay Checkout Modal */}
      <HesabPayModal />

      {/* Live Chat Modal */}
      {chatRecipient && (
        <ChatModal
          recipientId={chatRecipient.id}
          recipientName={chatRecipient.name}
          onClose={() => setChatRecipient(null)}
        />
      )}

      {/* Footer */}
      <Footer setCurrentTab={setCurrentTab} />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <CurrencyProvider>
          <AuthProvider>
            <MarketplaceProvider>
              <MainAppContent />
            </MarketplaceProvider>
          </AuthProvider>
        </CurrencyProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
