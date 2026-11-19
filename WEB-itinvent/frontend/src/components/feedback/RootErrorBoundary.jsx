import { Component } from 'react';

// Top-level boundary in main.jsx: wraps every provider so a throw during
// bootstrap (storage, preferences, notifications) degrades to a fallback
// instead of an empty #root. Deliberately uses plain DOM — MUI/theme/context
// may be the very thing that failed.
export default class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('App bootstrap failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            background: '#07090c',
            color: '#fff',
            padding: 16,
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              HUB-IT не удалось запустить
            </div>
            <div style={{ color: 'rgba(255,255,255,0.62)', fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
              Произошла ошибка при загрузке приложения. Попробуйте обновить страницу.
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                minHeight: 48,
                borderRadius: 16,
                border: 0,
                padding: '0 20px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                background: '#a5f3fc',
                color: '#09090b',
              }}
            >
              Обновить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
