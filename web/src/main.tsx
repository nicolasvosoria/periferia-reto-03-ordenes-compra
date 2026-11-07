import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('No existe #root');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
