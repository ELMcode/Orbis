import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { LanguageProvider } from './hooks/useLanguage';
import { ToastProvider } from './hooks/useToast';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <BrowserRouter>
            <ToastProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ToastProvider>
          </BrowserRouter>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
