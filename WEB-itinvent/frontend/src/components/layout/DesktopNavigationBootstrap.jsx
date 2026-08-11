import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeDesktopNavigation } from '../../lib/desktopBridge';

const DesktopNavigationBootstrap = () => {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => subscribeDesktopNavigation((route) => {
    navigateRef.current(route);
  }), []);

  return null;
};

export default DesktopNavigationBootstrap;
