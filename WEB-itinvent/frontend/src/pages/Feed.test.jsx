import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Feed from './Feed';
import { hubAnnouncementsAPI } from '../api/hubAnnouncements';

vi.mock('../api/hubAnnouncements', () => ({ hubAnnouncementsAPI: {
  getAnnouncements: vi.fn(), getCategories: vi.fn(), getTags: vi.fn(),
} }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: {}, hasPermission: () => false }) }));
vi.mock('../contexts/NotificationContext', () => ({ useNotification: () => ({}) }));
vi.mock('../components/layout/MainLayout', () => ({ default: ({ children }) => children }));
vi.mock('../components/layout/PageShell', () => ({ default: ({ children }) => children }));
vi.mock('../components/feed/FeedPostCard', () => ({ default: ({ post }) => <div>{post.title}</div> }));
vi.mock('../components/feed/FeedSidebar', () => ({ default: ({ query, onQueryChange }) => (
  <input aria-label="Feed search" value={query} onChange={(event) => onQueryChange(event.target.value)} />
) }));
vi.mock('../components/feed/FeedComposerDialog', () => ({ default: () => null }));
vi.mock('../components/feed/FeedCommentsPanel', () => ({ default: () => null }));
vi.mock('../components/feed/FeedReactionsDialog', () => ({ default: () => null }));
vi.mock('../components/feed/FeedShareDialog', () => ({ default: () => null }));
vi.mock('../components/feed/FeedQuickComposer', () => ({ default: () => null }));

describe('Feed request ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hubAnnouncementsAPI.getCategories.mockResolvedValue({ items: [] });
    hubAnnouncementsAPI.getTags.mockResolvedValue({ items: [] });
  });

  it('does not append an old page after changing the search', async () => {
    const pending = [];
    hubAnnouncementsAPI.getAnnouncements.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    render(<MemoryRouter><Feed /></MemoryRouter>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0]({ items: [{ id: 1, title: 'First page' }], total: 2 }); });
    fireEvent.click(screen.getByRole('button', { name: /Показать ещё/ }));
    expect(pending).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Feed search'), { target: { value: 'new' } });
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => { pending[2]({ items: [{ id: 3, title: 'New result' }], total: 1 }); });
    await act(async () => { pending[1]({ items: [{ id: 2, title: 'Old page' }], total: 2 }); });
    expect(screen.getByText('New result')).toBeInTheDocument();
    expect(screen.queryByText('Old page')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'])('ignores an old search that completes with %s', async (outcome) => {
    const pending = [];
    hubAnnouncementsAPI.getAnnouncements.mockImplementation(() => new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
    }));
    render(<MemoryRouter><Feed /></MemoryRouter>);
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Feed search'), { target: { value: 'new' } });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1].resolve({ items: [{ id: 2, title: 'New result' }], total: 1 }); });
    expect(screen.getByText('New result')).toBeInTheDocument();
    await act(async () => {
      if (outcome === 'resolve') pending[0].resolve({ items: [{ id: 1, title: 'Old result' }], total: 1 });
      else pending[0].reject(new Error('Old error'));
    });
    expect(screen.getByText('New result')).toBeInTheDocument();
    expect(screen.queryByText('Old result')).not.toBeInTheDocument();
    expect(screen.queryByText('Old error')).not.toBeInTheDocument();
  });
});
