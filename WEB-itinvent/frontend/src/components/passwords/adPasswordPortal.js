export const AD_PASSWORD_PORTAL_URL = 'https://tmn-srv-rgw-01.zsgp.corp/RDWeb/Pages/ru-RU/password.aspx';

export const openAdPasswordPortal = () => {
  window.open(AD_PASSWORD_PORTAL_URL, '_blank', 'noopener,noreferrer');
};
