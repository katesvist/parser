import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { TendersProvider } from './context/TendersContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TendersProvider>
      <App />
    </TendersProvider>
  </StrictMode>
);
