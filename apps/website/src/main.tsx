import React from 'react';
import {hydrateRoot, createRoot} from 'react-dom/client';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/ibm-plex-sans-thai/400.css';
import '@fontsource/ibm-plex-sans-thai/500.css';
import '@fontsource/ibm-plex-sans-thai/600.css';
import {App} from './App';
import {route} from './site';
import './style.css';
import './tokens.css';
import './landing.css';

const container = document.getElementById('root')!;
const app = <React.StrictMode><App {...route(location.pathname)} /></React.StrictMode>;
if (container.hasChildNodes() && document.documentElement.dataset.page !== '404') hydrateRoot(container, app);
else createRoot(container).render(app);
