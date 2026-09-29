import { apiClient } from './client';

let ticketRequest = null;

// D5/W8: web sockets cannot read the httpOnly access token, so in-socket
// re-auth uses a short-lived ws_ticket minted under the current auth cookie.
// R-W8-5: via apiClient so a 401 triggers the axios silent-refresh chain.
export function getWsTicket() {
  if (!ticketRequest) {
    ticketRequest = apiClient
      .post('/chat/ws-ticket', null)
      .then((response) => {
        const ticket = String(response?.data?.ws_ticket || '').trim();
        if (!ticket) throw new Error('empty ws_ticket');
        return ticket;
      })
      .finally(() => {
        ticketRequest = null;
      });
  }
  return ticketRequest;
}
