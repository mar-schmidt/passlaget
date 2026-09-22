import React from 'react';
import ReactDOM from 'react-dom/client';
import TeamEntry from './TeamEntry';
import './styles.css';
import './theme-matchday.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TeamEntry />
  </React.StrictMode>,
);
