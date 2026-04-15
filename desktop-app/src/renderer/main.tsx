import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

class RendererBootstrap {
  constructor(private readonly rootId: string) {}

  registerWindowGuards(): void {
    document.addEventListener("dragover", this.preventDefaultNavigation);
    document.addEventListener("drop", this.preventDefaultNavigation);
  }

  render(): void {
    const container = document.getElementById(this.rootId);

    if (!container) {
      throw new Error(`Missing renderer root element: ${this.rootId}`);
    }

    ReactDOM.createRoot(container).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }

  private preventDefaultNavigation = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
}

const bootstrap = new RendererBootstrap("root");
bootstrap.registerWindowGuards();
bootstrap.render();
