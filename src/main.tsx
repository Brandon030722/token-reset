import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DesktopApp from './DesktopApp';
import { isDesktop } from './desktop';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{isDesktop ? <DesktopApp /> : <App />}</React.StrictMode>);
