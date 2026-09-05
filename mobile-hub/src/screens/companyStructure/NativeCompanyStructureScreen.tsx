import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createCompanyStructureNode,
  deleteCompanyStructureNode,
  deleteCompanyStructureNodePhoto,
  getCompanyStructureNodePeople,
  getCompanyStructureTree,
  importCompanyStructureFromZup,
  moveCompanyStructureNode,
  searchCompanyStructure,
  updateCompanyStructureNode,
  uploadCompanyStructureNodePhoto,
  type CompanyStructureNode,
  type CompanyStructureNodeDraft,
  type CompanyStructurePerson,
  type CompanyStructureSearchItem,
} from '../../api/companyStructureApi';
import { formatApiError } from '../../api/formatError';
import { normalizePhoneDigits } from '../../addressBook/addressBookFormat';
import { openExternalUrl } from '../../addressBook/messengerLinks';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeEntitySnapshot,
  readNativeSnapshot,
  writeNativeEntitySnapshot,
  writeNativeSnapshot,
} from '../../cache/nativeSnapshotCache';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import {
  companyNodeTitle,
  companyPersonKey,
  companySearchMeta,
  buildCompanyStructureIndex,
  companyNodePathFromIndex,
  companyNodeUsesLeader,
  getCompanyRootAndBlocks,
  groupCompanyPeople,
  resolveInitialCompanySelection,
  searchItemToCompanyPerson,
  sortedCompanyChildren,
  sortCompanyPeople,
} from '../../companyStructure/nativeCompanyStructureModel';
import type {
  NativeCompanyStructurePeopleSnapshot,
  NativeCompanyStructureTreeSnapshot,
} from '../../companyStructure/nativeCompanyStructureSnapshot';
import { NativeCompanyNodeEditorSheet } from '../../components/companyStructure/NativeCompanyNodeEditorSheet';
import { NativeCompanyZupImportSheet } from '../../components/companyStructure/NativeCompanyZupImportSheet';
import { NativeCompanyHierarchySheet } from '../../components/companyStructure/NativeCompanyHierarchySheet';
import { NativeCompanyNodeCard } from '../../components/companyStructure/NativeCompanyNodeCard';
import { NativeCompanyPeopleSheet } from '../../components/companyStructure/NativeCompanyPeopleSheet';
import { NativeCompanyPersonCard } from '../../components/companyStructure/NativeCompanyPersonCard';
import { openPortalPath } from '../../navigation/moduleRegistry';
import {
  NativeFilePermissionError,
  openAppPermissionSettings,
  pickNativeAttachment,
} from '../../files/nativeFilePicker';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 30;
const PEOPLE_LIMIT = 2_000;

type ListItem =
  | { kind: 'node'; node: CompanyStructureNode }
  | { kind: 'people-heading'; key: string; title: string; count: number }
  | { kind: 'person'; person: CompanyStructurePerson; index: number }
  | { kind: 'search'; item: CompanyStructureSearchItem; index: number };

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

export function NativeCompanyStructureScreen() {
  const params = useLocalSearchParams<{ nodeId?: string | string[]; blockId?: string | string[] }>();
  const requestedNodeParam = first(params.nodeId);
  const requestedBlockParam = first(params.blockId);
  const requestedNodeRef = useRef(requestedNodeParam);
  const requestedBlockRef = useRef(requestedBlockParam);
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('company_structure.read');
  const canWrite = hasPermission('company_structure.write');
  const [tree, setTree] = useState<CompanyStructureNode[]>([]);
  const [treeRevision, setTreeRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [activeBlockId, setActiveBlockId] = useState('');
  const [people, setPeople] = useState<CompanyStructurePerson[]>([]);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [query, setQuery] = useState('');
  const [searchItems, setSearchItems] = useState<CompanyStructureSearchItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [focusedName, setFocusedName] = useState('');
  const [detachedPerson, setDetachedPerson] = useState<CompanyStructurePerson | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [mutationMessage, setMutationMessage] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const treeRequestRef = useRef(0);
  const peopleRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const selectedIdRef = useRef('');
  const activeBlockIdRef = useRef('');
  const peopleCacheRef = useRef(new Map<string, { items: CompanyStructurePerson[]; total: number }>());

  const treeIndex = useMemo(() => buildCompanyStructureIndex(tree), [tree]);
  const selectedNode = treeIndex.nodeById.get(selectedId) || null;
  const selectedPath = useMemo(() => companyNodePathFromIndex(treeIndex, selectedId), [selectedId, treeIndex]);
  const { blocks } = useMemo(() => getCompanyRootAndBlocks(tree), [tree]);
  const children = useMemo(() => sortedCompanyChildren(selectedNode), [selectedNode]);
  const sortedPeople = useMemo(() => sortCompanyPeople(people), [people]);
  const searchMode = query.trim().length >= 2;

  const selectNode = useCallback((nodeId: string, options: { preserveFocus?: boolean } = {}) => {
    const node = treeIndex.nodeById.get(nodeId);
    if (!node) return;
    const path = companyNodePathFromIndex(treeIndex, node.id);
    const block = path.find((part) => part.node_type === 'block');
    selectedIdRef.current = node.id;
    setSelectedId(node.id);
    if (block) {
      activeBlockIdRef.current = block.id;
      setActiveBlockId(block.id);
    }
    setPeople([]);
    setPeopleTotal(0);
    setPeopleError('');
    if (!options.preserveFocus) setFocusedName('');
    setDetachedPerson(null);
  }, [treeIndex]);

  useEffect(() => {
    if (
      requestedNodeRef.current === requestedNodeParam
      && requestedBlockRef.current === requestedBlockParam
    ) return;
    requestedNodeRef.current = requestedNodeParam;
    requestedBlockRef.current = requestedBlockParam;
    if (!tree.length) return;
    const selection = resolveInitialCompanySelection(tree, requestedNodeParam, requestedBlockParam);
    if (selection.nodeId) selectNode(selection.nodeId);
  }, [requestedBlockParam, requestedNodeParam, selectNode, tree]);

  const loadTree = useCallback(async (refresh = false) => {
    if (!canRead) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const requestId = ++treeRequestRef.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    const userId = Number(user?.id || 0);
    let cached = false;
    if (userId) {
      const snapshot = await readNativeSnapshot<NativeCompanyStructureTreeSnapshot>('company-structure-tree', userId);
      if (requestId !== treeRequestRef.current) return;
      if (snapshot) {
        cached = true;
        setTree(snapshot.data.items);
        const selection = resolveInitialCompanySelection(
          snapshot.data.items,
          selectedIdRef.current || requestedNodeRef.current,
          activeBlockIdRef.current || requestedBlockRef.current,
        );
        selectedIdRef.current = selection.nodeId;
        activeBlockIdRef.current = selection.blockId;
        setSelectedId(selection.nodeId);
        setActiveBlockId(selection.blockId);
        setTreeRevision((current) => current + 1);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (!cached) setError('Нет подключения и сохранённой структуры компании.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const payload = await getCompanyStructureTree();
      if (requestId !== treeRequestRef.current) return;
      setTree(payload.items);
      peopleCacheRef.current.clear();
      const selection = resolveInitialCompanySelection(
        payload.items,
        selectedIdRef.current || requestedNodeRef.current,
        activeBlockIdRef.current || requestedBlockRef.current,
      );
      selectedIdRef.current = selection.nodeId;
      activeBlockIdRef.current = selection.blockId;
      setSelectedId(selection.nodeId);
      setActiveBlockId(selection.blockId);
      setTreeRevision((current) => current + 1);
      if (userId) void writeNativeSnapshot<NativeCompanyStructureTreeSnapshot>('company-structure-tree', userId, payload);
    } catch (cause) {
      if (requestId === treeRequestRef.current) {
        if (cached) setError('Показана сохранённая структура. Обновить данные не удалось.');
        else setError(formatApiError(cause, 'Не удалось загрузить структуру компании.'));
      }
    } finally {
      if (requestId === treeRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [canRead, offlineMode, user?.id]);

  useEffect(() => { void loadTree(); }, [loadTree]);

  const loadPeople = useCallback(async (nodeId: string, force = false) => {
    const id = String(nodeId || '').trim();
    if (!id || !canRead) {
      setPeopleLoading(false);
      return;
    }
    if (!force) {
      const cached = peopleCacheRef.current.get(id);
      if (cached) {
        setPeople(cached.items);
        setPeopleTotal(cached.total);
        setPeopleError('');
        setPeopleLoading(false);
        return;
      }
    }
    const requestId = ++peopleRequestRef.current;
    setPeopleLoading(true);
    setPeopleError('');
    const userId = Number(user?.id || 0);
    let cached = false;
    if (userId) {
      const snapshot = await readNativeEntitySnapshot<NativeCompanyStructurePeopleSnapshot>(
        'company-structure-people',
        userId,
        id,
      );
      if (requestId !== peopleRequestRef.current || id !== selectedIdRef.current) return;
      if (snapshot) {
        cached = true;
        const next = { items: snapshot.data.items, total: snapshot.data.total };
        peopleCacheRef.current.set(id, next);
        setPeople(next.items);
        setPeopleTotal(next.total);
        setPeopleLoading(false);
      }
    }
    if (offlineMode) {
      if (!cached) {
        setPeople([]);
        setPeopleTotal(0);
        setPeopleError('Сотрудники этого подразделения ещё не сохранены. Откройте его один раз при наличии интернета.');
      }
      setPeopleLoading(false);
      return;
    }
    try {
      const payload = await getCompanyStructureNodePeople(id, { limit: PEOPLE_LIMIT, includeDescendants: true });
      if (requestId !== peopleRequestRef.current || id !== selectedIdRef.current) return;
      const next = { items: payload.items, total: payload.total };
      peopleCacheRef.current.delete(id);
      peopleCacheRef.current.set(id, next);
      while (peopleCacheRef.current.size > 24) {
        const oldest = peopleCacheRef.current.keys().next().value;
        if (oldest === undefined) break;
        peopleCacheRef.current.delete(oldest);
      }
      setPeople(next.items);
      setPeopleTotal(next.total);
      if (userId) {
        void writeNativeEntitySnapshot<NativeCompanyStructurePeopleSnapshot>(
          'company-structure-people',
          userId,
          id,
          payload,
        );
      }
    } catch (cause) {
      if (requestId === peopleRequestRef.current && id === selectedIdRef.current) {
        if (cached) setPeopleError('Показан сохранённый список сотрудников. Обновить данные не удалось.');
        else {
          setPeople([]);
          setPeopleTotal(0);
          setPeopleError(formatApiError(cause, 'Не удалось загрузить сотрудников подразделения.'));
        }
      }
    } finally {
      if (requestId === peopleRequestRef.current) setPeopleLoading(false);
    }
  }, [canRead, offlineMode, user?.id]);

  useEffect(() => {
    setPeople([]);
    setPeopleTotal(0);
    if (selectedId) void loadPeople(selectedId);
  }, [loadPeople, selectedId, treeRevision]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2 || !canRead) {
      searchRequestRef.current += 1;
      setSearchItems([]);
      setSearchTotal(0);
      setSearchLoading(false);
      return undefined;
    }
    if (offlineMode) {
      const needle = normalized.toLocaleLowerCase('ru-RU');
      const localItems: CompanyStructureSearchItem[] = [];
      treeIndex.nodeById.forEach((node) => {
        const haystack = `${companyNodeTitle(node)} ${node.person_name} ${node.person_position}`.toLocaleLowerCase('ru-RU');
        if (!haystack.includes(needle)) return;
        const path = companyNodePathFromIndex(treeIndex, node.id).map((part) => ({ id: part.id, title: companyNodeTitle(part) }));
        localItems.push({
          kind: 'node',
          node_id: node.id,
          title: companyNodeTitle(node),
          subtitle: node.person_position,
          department: '',
          department_location: '',
          work_phones: [],
          work_emails: [],
          path,
        });
      });
      peopleCacheRef.current.forEach((cachedPeople, nodeId) => {
        const path = companyNodePathFromIndex(treeIndex, nodeId).map((part) => ({ id: part.id, title: companyNodeTitle(part) }));
        cachedPeople.items.forEach((person) => {
          const haystack = `${person.full_name} ${person.position} ${person.department} ${person.department_location}`.toLocaleLowerCase('ru-RU');
          if (!haystack.includes(needle)) return;
          localItems.push({
            kind: 'person',
            node_id: nodeId,
            title: person.full_name,
            subtitle: person.position,
            department: person.department,
            department_location: person.department_location,
            work_phones: person.work_phones,
            work_emails: person.work_emails,
            path,
          });
        });
      });
      setSearchItems(localItems.slice(0, SEARCH_LIMIT));
      setSearchTotal(localItems.length);
      setSearchLoading(false);
      return undefined;
    }
    const requestId = ++searchRequestRef.current;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      void searchCompanyStructure(normalized, SEARCH_LIMIT).then((payload) => {
        if (requestId !== searchRequestRef.current) return;
        setSearchItems(payload.items);
        setSearchTotal(payload.total);
      }).catch((cause) => {
        if (requestId === searchRequestRef.current) {
          setSearchItems([]);
          setSearchTotal(0);
          setError(formatApiError(cause, 'Не удалось выполнить поиск по структуре.'));
        }
      }).finally(() => {
        if (requestId === searchRequestRef.current) setSearchLoading(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [canRead, offlineMode, query, treeIndex]);

  const closePeople = useCallback(() => {
    setPeopleOpen(false);
    setDetachedPerson(null);
    setFocusedName('');
  }, []);

  const goToParent = useCallback(() => {
    const parent = selectedPath[selectedPath.length - 2];
    if (parent) selectNode(parent.id);
  }, [selectNode, selectedPath]);

  useAndroidBackHandler(() => {
    if (hierarchyOpen) {
      setHierarchyOpen(false);
      return true;
    }
    if (peopleOpen) {
      closePeople();
      return true;
    }
    if (query) {
      setQuery('');
      return true;
    }
    if (selectedPath.length > 1) {
      goToParent();
      return true;
    }
    return false;
  });

  const openNodePeople = useCallback((nodeId: string, focus = '') => {
    if (nodeId !== selectedId) selectNode(nodeId, { preserveFocus: Boolean(focus) });
    setFocusedName(focus);
    setDetachedPerson(null);
    setPeopleOpen(true);
  }, [selectNode, selectedId]);

  const chooseSearchItem = useCallback((item: CompanyStructureSearchItem) => {
    if (item.kind === 'node' && item.node_id) {
      setQuery('');
      selectNode(item.node_id);
      return;
    }
    if (item.kind === 'person') {
      const person = searchItemToCompanyPerson(item);
      if (item.node_id) {
        selectNode(item.node_id, { preserveFocus: true });
        setDetachedPerson(null);
      } else {
        setDetachedPerson(person);
      }
      setFocusedName(person.full_name);
      setPeopleOpen(true);
    }
  }, [selectNode]);

  const openCreate = useCallback(() => {
    if (!selectedNode || !canWrite || offlineMode) return;
    setMutationError('');
    setMutationMessage('');
    setEditorMode('create');
    setEditorOpen(true);
  }, [canWrite, offlineMode, selectedNode]);

  const openEdit = useCallback(() => {
    if (!selectedNode || !canWrite || offlineMode) return;
    setMutationError('');
    setMutationMessage('');
    setEditorMode('edit');
    setEditorOpen(true);
  }, [canWrite, offlineMode, selectedNode]);

  const saveNode = useCallback(async (draft: CompanyStructureNodeDraft) => {
    if (!canWrite || offlineMode || (editorMode === 'edit' && !selectedNode)) return;
    setMutating(true);
    setMutationError('');
    setMutationMessage('');
    try {
      const saved = editorMode === 'create'
        ? await createCompanyStructureNode(draft)
        : await updateCompanyStructureNode(selectedNode!.id, draft);
      selectedIdRef.current = saved.id;
      setEditorOpen(false);
      await loadTree(true);
      setMutationMessage(editorMode === 'create' ? 'Узел создан.' : 'Изменения сохранены.');
    } catch (cause) {
      setMutationError(formatApiError(cause, 'Не удалось сохранить узел. Проверьте родителя и привязки ЗУП.'));
    } finally {
      setMutating(false);
    }
  }, [canWrite, editorMode, loadTree, offlineMode, selectedNode]);

  const siblings = useMemo(() => {
    if (!selectedNode) return [];
    const parent = selectedNode.parent_id ? treeIndex.nodeById.get(selectedNode.parent_id) : null;
    return [...(parent ? parent.children : tree)].sort((left, right) => (
      left.sort_order - right.sort_order || companyNodeTitle(left).localeCompare(companyNodeTitle(right), 'ru')
    ));
  }, [selectedNode, tree, treeIndex]);
  const selectedPosition = siblings.findIndex((node) => node.id === selectedNode?.id);

  const moveSelected = useCallback(async (direction: -1 | 1) => {
    if (!selectedNode || !canWrite || offlineMode || mutating || selectedPosition < 0) return;
    const nextPosition = selectedPosition + direction;
    if (nextPosition < 0 || nextPosition >= siblings.length) return;
    setMutating(true);
    setMutationError('');
    setMutationMessage('');
    try {
      await moveCompanyStructureNode(selectedNode.id, {
        parentId: selectedNode.parent_id,
        position: nextPosition,
      });
      selectedIdRef.current = selectedNode.id;
      await loadTree(true);
      setMutationMessage('Порядок узлов обновлён.');
    } catch (cause) {
      setMutationError(formatApiError(cause, 'Не удалось изменить порядок узлов.'));
    } finally {
      setMutating(false);
    }
  }, [canWrite, loadTree, mutating, offlineMode, selectedNode, selectedPosition, siblings.length]);

  const confirmDelete = useCallback(() => {
    if (!selectedNode || !selectedNode.parent_id || !canWrite || offlineMode || mutating) return;
    const childCount = selectedNode.children.length;
    Alert.alert(
      `Удалить «${companyNodeTitle(selectedNode)}»?`,
      childCount
        ? `Дочерние узлы (${childCount}) будут переподчинены текущему родителю. Действие нельзя отменить.`
        : 'Действие нельзя отменить.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            const fallbackId = selectedNode.parent_id || '';
            setMutating(true);
            setMutationError('');
            setMutationMessage('');
            void deleteCompanyStructureNode(selectedNode.id, { force: childCount > 0 }).then(async () => {
              selectedIdRef.current = fallbackId;
              await loadTree(true);
              setMutationMessage('Узел удалён.');
            }).catch((cause) => {
              setMutationError(formatApiError(cause, 'Не удалось удалить узел. Структура могла измениться — обновите экран.'));
            }).finally(() => setMutating(false));
          },
        },
      ],
    );
  }, [canWrite, loadTree, mutating, offlineMode, selectedNode]);

  const uploadLeaderPhoto = useCallback(async (source: 'gallery' | 'camera') => {
    if (!selectedNode || !companyNodeUsesLeader(selectedNode.node_type) || !canWrite || offlineMode || mutating) return;
    setMutating(true);
    setMutationError('');
    setMutationMessage('');
    try {
      const file = await pickNativeAttachment(source);
      if (!file) return;
      await uploadCompanyStructureNodePhoto(selectedNode.id, file);
      selectedIdRef.current = selectedNode.id;
      await loadTree(true);
      setMutationMessage('Фото руководителя обновлено.');
    } catch (cause) {
      if (cause instanceof NativeFilePermissionError && !cause.canAskAgain) {
        Alert.alert('Нет доступа к камере', cause.message, [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Настройки', onPress: () => { void openAppPermissionSettings(); } },
        ]);
      }
      setMutationError(formatApiError(cause, 'Не удалось загрузить фото руководителя.'));
    } finally {
      setMutating(false);
    }
  }, [canWrite, loadTree, mutating, offlineMode, selectedNode]);

  const chooseLeaderPhoto = useCallback(() => {
    if (!selectedNode || !canWrite || offlineMode || mutating) return;
    Alert.alert('Фото руководителя', 'Выберите источник изображения до 2 МБ.', [
      { text: 'Галерея', onPress: () => { void uploadLeaderPhoto('gallery'); } },
      { text: 'Камера', onPress: () => { void uploadLeaderPhoto('camera'); } },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, [canWrite, mutating, offlineMode, selectedNode, uploadLeaderPhoto]);

  const confirmDeleteLeaderPhoto = useCallback(() => {
    if (!selectedNode?.person_photo_url || !canWrite || offlineMode || mutating) return;
    Alert.alert('Удалить фото руководителя?', 'Фото будет удалено из карточки структуры.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          const nodeId = selectedNode.id;
          setMutating(true);
          setMutationError('');
          setMutationMessage('');
          void deleteCompanyStructureNodePhoto(nodeId).then(async () => {
            selectedIdRef.current = nodeId;
            await loadTree(true);
            setMutationMessage('Фото руководителя удалено.');
          }).catch((cause) => {
            setMutationError(formatApiError(cause, 'Не удалось удалить фото руководителя.'));
          }).finally(() => setMutating(false));
        },
      },
    ]);
  }, [canWrite, loadTree, mutating, offlineMode, selectedNode]);

  const requestZupImport = useCallback((departments: string[]) => {
    if (!selectedNode || !canWrite || offlineMode || mutating || !departments.length) return;
    Alert.alert(
      'Подтвердить импорт из ЗУП?',
      `${departments.length} подразделений будут созданы внутри «${companyNodeTitle(selectedNode)}». Уже добавленные карточки сервер пропустит.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Импортировать',
          onPress: () => {
            const parentId = selectedNode.id;
            setMutating(true);
            setMutationError('');
            setMutationMessage('');
            void importCompanyStructureFromZup(parentId, departments).then(async (result) => {
              selectedIdRef.current = result.created[0]?.id || parentId;
              setImportOpen(false);
              await loadTree(true);
              setMutationMessage(result.created.length
                ? `Добавлено из ЗУП: ${result.created.length}${result.skipped.length ? `, пропущено: ${result.skipped.length}` : ''}.`
                : `Новые карточки не добавлены${result.skipped.length ? `: пропущено ${result.skipped.length}` : ''}.`);
            }).catch((cause) => {
              setMutationError(formatApiError(cause, 'Не удалось импортировать подразделения из ЗУП.'));
            }).finally(() => setMutating(false));
          },
        },
      ],
    );
  }, [canWrite, loadTree, mutating, offlineMode, selectedNode]);

  const handleCall = useCallback((phone: string) => {
    const digits = normalizePhoneDigits(phone);
    const href = digits ? `tel:+${digits}` : `tel:${phone}`;
    void openExternalUrl(href).then((opened) => {
      if (!opened) setError('Не удалось открыть звонок.');
    });
  }, []);

  const handleEmail = useCallback((email: string) => {
    const recipient = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(recipient)) {
      setError('Некорректный рабочий e-mail.');
      return;
    }
    openPortalPath(`/mail?compose_to=${encodeURIComponent(recipient)}`);
  }, []);

  const listItems = useMemo<ListItem[]>(() => {
    if (searchMode) return searchItems.map((item, index) => ({ kind: 'search', item, index }));
    if (children.length) return children.map((node) => ({ kind: 'node', node }));
    return groupCompanyPeople(sortedPeople).flatMap((section) => [
      { kind: 'people-heading', key: section.key, title: section.title, count: section.items.length } as ListItem,
      ...section.items.map((person, index) => ({ kind: 'person', person, index } as ListItem)),
    ]);
  }, [children, searchItems, searchMode, sortedPeople]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Структура компании" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право company_structure.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const sheetPeople = detachedPerson ? [detachedPerson] : people;
  return (
    <AccountScreenScaffold
      title="Структура компании"
      tokens={tokens}
      scroll={false}
      onBack={selectedPath.length > 1 ? goToParent : undefined}
      rightAction={(
        <View style={styles.headerActions}>
          <Pressable onPress={() => { void loadTree(true); }} disabled={refreshing || offlineMode} accessibilityRole="button" accessibilityLabel="Обновить структуру" style={styles.headerAction}>
            {refreshing ? <ActivityIndicator size="small" color={tokens.primary} /> : <MaterialCommunityIcons name="refresh" size={22} color={tokens.primary} />}
          </Pressable>
          <Pressable
            testID="native-company-open-hierarchy"
            onPress={() => setHierarchyOpen(true)}
            disabled={!tree.length}
            accessibilityRole="button"
            accessibilityLabel="Открыть всю структуру"
            accessibilityState={{ disabled: !tree.length }}
            style={[styles.headerAction, { opacity: tree.length ? 1 : 0.5 }]}
          >
            <MaterialCommunityIcons name="file-tree-outline" size={22} color={tokens.primary} />
          </Pressable>
        </View>
      )}
    >
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: показана сохранённая структура, поиск выполняется на устройстве.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {mutationError && !editorOpen ? <Text accessibilityRole="alert" style={[styles.mutationError, { color: tokens.error }]}>{mutationError}</Text> : null}
      {mutationMessage ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={[styles.mutationMessage, { color: tokens.success }]}>{mutationMessage}</Text> : null}
      <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
        <TextInput
          testID="native-company-search"
          value={query}
          onChangeText={(value) => { setQuery(value); setError(''); }}
          editable
          placeholder="Сотрудник или подразделение"
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Поиск по структуре компании"
          returnKeyType="search"
          style={[styles.searchInput, { color: tokens.textPrimary }]}
        />
        {searchLoading ? <ActivityIndicator size="small" color={tokens.primary} /> : query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.clearSearch}>
            <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
      </View>

      {!searchMode && blocks.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.blockTabs} accessibilityRole="tablist">
          {blocks.map((block) => {
            const selected = block.id === activeBlockId;
            return (
              <Pressable
                key={block.id}
                onPress={() => selectNode(block.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.blockTab, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
              >
                <Text numberOfLines={1} style={[styles.blockText, { color: selected ? '#fff' : tokens.textPrimary }]}>{companyNodeTitle(block)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {!searchMode && selectedPath.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbs} accessibilityLabel="Путь по структуре компании">
          {selectedPath.map((node, index) => (
            <View key={node.id} style={styles.breadcrumbItem}>
              {index ? <MaterialCommunityIcons name="chevron-right" size={17} color={tokens.iconMuted} /> : null}
              <Pressable onPress={() => selectNode(node.id)} disabled={index === selectedPath.length - 1} accessibilityRole="button" accessibilityState={{ disabled: index === selectedPath.length - 1 }} style={styles.breadcrumbButton}>
                <Text style={[styles.breadcrumbText, { color: index === selectedPath.length - 1 ? tokens.textPrimary : tokens.primary }]}>{companyNodeTitle(node)}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {loading && !tree.length ? (
        <View accessibilityRole="progressbar" accessibilityLabel="Загрузка структуры компании" style={styles.loading}>
          <ActivityIndicator color={tokens.primary} />
        </View>
      ) : (
        <FlatList
          testID="native-company-list"
          data={listItems}
          keyExtractor={(entry) => entry.kind === 'node'
            ? `node-${entry.node.id}`
            : entry.kind === 'people-heading'
              ? `heading-${entry.key}`
            : entry.kind === 'person'
              ? `person-${companyPersonKey(entry.person, entry.index)}`
              : `search-${entry.item.kind}-${entry.item.node_id || ''}-${entry.item.title}-${entry.index}`}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadTree(true); }}
          contentContainerStyle={listItems.length ? styles.list : styles.emptyList}
          ListHeaderComponent={searchMode ? (
            <View style={styles.listHeader}>
              <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Результаты · {searchTotal}</Text>
              {searchTotal > SEARCH_LIMIT ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>Показаны первые {SEARCH_LIMIT}. Уточните запрос.</Text> : null}
            </View>
          ) : selectedNode ? (
            <View style={styles.listHeader}>
              <NativeCompanyNodeCard node={selectedNode} tokens={tokens} selected onPeople={openNodePeople} />
              {canWrite ? (
                <View style={styles.editorActions}>
                  <Pressable testID="native-company-create" disabled={offlineMode || mutating} onPress={openCreate} accessibilityRole="button" accessibilityLabel={`Добавить узел внутри ${companyNodeTitle(selectedNode)}`} style={[styles.editorPrimary, { backgroundColor: tokens.primary, opacity: offlineMode || mutating ? 0.5 : 1 }]}>
                    <MaterialCommunityIcons name="plus" size={20} color="#fff" />
                    <Text style={styles.editorPrimaryText}>Добавить</Text>
                  </Pressable>
                  <Pressable testID="native-company-import-zup" disabled={offlineMode || mutating} onPress={() => { setMutationError(''); setMutationMessage(''); setImportOpen(true); }} accessibilityRole="button" accessibilityLabel={`Добавить подразделения из ЗУП внутри ${companyNodeTitle(selectedNode)}`} style={[styles.editorSecondary, { borderColor: tokens.border, opacity: offlineMode || mutating ? 0.5 : 1 }]}>
                    <MaterialCommunityIcons name="database-import-outline" size={20} color={tokens.primary} />
                    <Text style={[styles.editorSecondaryText, { color: tokens.primary }]}>Из ЗУП</Text>
                  </Pressable>
                  <Pressable testID="native-company-edit" disabled={offlineMode || mutating} onPress={openEdit} accessibilityRole="button" accessibilityLabel={`Изменить ${companyNodeTitle(selectedNode)}`} style={[styles.editorIcon, { borderColor: tokens.border }]}>
                    <MaterialCommunityIcons name="pencil-outline" size={20} color={tokens.primary} />
                  </Pressable>
                  <Pressable disabled={offlineMode || mutating || selectedPosition <= 0} onPress={() => { void moveSelected(-1); }} accessibilityRole="button" accessibilityLabel="Переместить выше" accessibilityState={{ disabled: offlineMode || mutating || selectedPosition <= 0 }} style={[styles.editorIcon, { borderColor: tokens.border, opacity: selectedPosition <= 0 ? 0.4 : 1 }]}>
                    <MaterialCommunityIcons name="arrow-up" size={20} color={tokens.textPrimary} />
                  </Pressable>
                  <Pressable disabled={offlineMode || mutating || selectedPosition < 0 || selectedPosition >= siblings.length - 1} onPress={() => { void moveSelected(1); }} accessibilityRole="button" accessibilityLabel="Переместить ниже" accessibilityState={{ disabled: offlineMode || mutating || selectedPosition < 0 || selectedPosition >= siblings.length - 1 }} style={[styles.editorIcon, { borderColor: tokens.border, opacity: selectedPosition < 0 || selectedPosition >= siblings.length - 1 ? 0.4 : 1 }]}>
                    <MaterialCommunityIcons name="arrow-down" size={20} color={tokens.textPrimary} />
                  </Pressable>
                  <Pressable testID="native-company-delete" disabled={offlineMode || mutating || !selectedNode.parent_id} onPress={confirmDelete} accessibilityRole="button" accessibilityLabel={`Удалить ${companyNodeTitle(selectedNode)}`} accessibilityState={{ disabled: offlineMode || mutating || !selectedNode.parent_id }} style={[styles.editorIcon, { borderColor: tokens.border, opacity: !selectedNode.parent_id ? 0.4 : 1 }]}>
                    <MaterialCommunityIcons name="delete-outline" size={20} color={tokens.error} />
                  </Pressable>
                  {companyNodeUsesLeader(selectedNode.node_type) ? (
                    <Pressable testID="native-company-photo" disabled={offlineMode || mutating} onPress={chooseLeaderPhoto} accessibilityRole="button" accessibilityLabel={`Изменить фото руководителя ${companyNodeTitle(selectedNode)}`} style={[styles.editorIcon, { borderColor: tokens.border }]}>
                      <MaterialCommunityIcons name="camera-outline" size={20} color={tokens.primary} />
                    </Pressable>
                  ) : null}
                  {companyNodeUsesLeader(selectedNode.node_type) && selectedNode.person_photo_url ? (
                    <Pressable testID="native-company-delete-photo" disabled={offlineMode || mutating} onPress={confirmDeleteLeaderPhoto} accessibilityRole="button" accessibilityLabel={`Удалить фото руководителя ${companyNodeTitle(selectedNode)}`} style={[styles.editorIcon, { borderColor: tokens.border }]}>
                      <MaterialCommunityIcons name="image-remove-outline" size={20} color={tokens.error} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>
                {children.length ? `Внутри · ${children.length}` : `Сотрудники · ${peopleTotal}`}
              </Text>
              {peopleError ? (
                <Pressable onPress={() => { void loadPeople(selectedNode.id, true); }} accessibilityRole="button" style={[styles.inlineError, { borderColor: tokens.error }]}>
                  <Text style={[styles.error, { color: tokens.error }]}>{peopleError}</Text>
                  <Text style={[styles.retryText, { color: tokens.primary }]}>Повторить</Text>
                </Pressable>
              ) : null}
              {peopleLoading && !children.length ? <ActivityIndicator style={styles.peopleLoader} color={tokens.primary} /> : null}
            </View>
          ) : null}
          ListEmptyComponent={(
            <View style={styles.emptyBody}>
              <MaterialCommunityIcons name={searchMode ? 'account-search-outline' : 'file-tree-outline'} size={42} color={tokens.iconMuted} />
              <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>{searchMode ? 'Ничего не найдено' : tree.length ? 'Сотрудники не указаны' : offlineMode ? 'Нет данных для автономного режима' : 'Структура пока пуста'}</Text>
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{searchMode ? 'Измените запрос или проверьте написание.' : offlineMode && !tree.length ? 'Подключитесь к сети и откройте раздел снова.' : 'Обновите экран и повторите попытку.'}</Text>
            </View>
          )}
          renderItem={({ item: entry }) => {
            if (entry.kind === 'node') {
              return <NativeCompanyNodeCard node={entry.node} tokens={tokens} onSelect={selectNode} onPeople={openNodePeople} />;
            }
            if (entry.kind === 'people-heading') {
              return (
                <View style={styles.peopleHeading}>
                  <Text style={[styles.peopleHeadingTitle, { color: tokens.textPrimary }]}>{entry.title}</Text>
                  <Text style={[styles.peopleHeadingCount, { color: tokens.textSecondary }]}>{entry.count}</Text>
                </View>
              );
            }
            if (entry.kind === 'person') {
              return <NativeCompanyPersonCard person={entry.person} tokens={tokens} onCall={handleCall} onEmail={handleEmail} />;
            }
            return (
              <Pressable onPress={() => chooseSearchItem(entry.item)} accessibilityRole="button" style={[styles.searchResult, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                <View style={[styles.resultIcon, { backgroundColor: tokens.accentSoft }]}>
                  <MaterialCommunityIcons name={entry.item.kind === 'person' ? 'account-outline' : 'office-building-outline'} size={22} color={tokens.primary} />
                </View>
                <View style={styles.resultBody}>
                  <Text style={[styles.resultTitle, { color: tokens.textPrimary }]}>{entry.item.title}</Text>
                  <Text numberOfLines={2} style={[styles.resultMeta, { color: tokens.textSecondary }]}>{companySearchMeta(entry.item)}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
              </Pressable>
            );
          }}
        />
      )}

      <NativeCompanyPeopleSheet
        visible={peopleOpen}
        title={detachedPerson ? 'Найденный сотрудник' : companyNodeTitle(selectedNode)}
        people={sheetPeople}
        total={detachedPerson ? 1 : peopleTotal}
        loading={!detachedPerson && peopleLoading}
        error={detachedPerson ? '' : peopleError}
        focusedName={focusedName}
        tokens={tokens}
        onClose={closePeople}
        onRetry={() => { if (selectedId) void loadPeople(selectedId, true); }}
        onCall={handleCall}
        onEmail={handleEmail}
      />
      <NativeCompanyHierarchySheet
        visible={hierarchyOpen}
        tree={tree}
        selectedId={selectedId}
        tokens={tokens}
        onClose={() => setHierarchyOpen(false)}
        onSelect={(nodeId) => {
          selectNode(nodeId);
          setHierarchyOpen(false);
        }}
      />
      <NativeCompanyNodeEditorSheet
        visible={editorOpen}
        mode={editorMode}
        tree={tree}
        selectedNode={selectedNode}
        saving={mutating}
        mutationError={mutationError}
        tokens={tokens}
        onClose={() => { if (!mutating) { setEditorOpen(false); setMutationError(''); } }}
        onSave={(draft) => { void saveNode(draft); }}
      />
      <NativeCompanyZupImportSheet
        visible={importOpen}
        parent={selectedNode}
        importing={mutating}
        mutationError={mutationError}
        tokens={tokens}
        onClose={() => { if (!mutating) { setImportOpen(false); setMutationError(''); } }}
        onRequestConfirmation={requestZupImport}
      />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  warning: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  mutationError: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  mutationMessage: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  searchBox: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 8 },
  clearSearch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  blockTabs: { gap: 7, paddingBottom: 8 },
  blockTab: { minHeight: 44, maxWidth: 240, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  blockText: { fontSize: 12, fontWeight: '800' },
  breadcrumbs: { alignItems: 'center', paddingBottom: 8 },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center' },
  breadcrumbButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 5 },
  breadcrumbText: { fontSize: 12, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 12 },
  emptyList: { flexGrow: 1, paddingBottom: 12 },
  listHeader: { paddingBottom: 5 },
  editorActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  editorPrimary: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  editorPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  editorSecondary: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  editorSecondaryText: { fontSize: 12, fontWeight: '900' },
  editorIcon: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { marginBottom: 8, fontSize: 15, fontWeight: '900' },
  hint: { marginTop: -4, marginBottom: 8, fontSize: 11, lineHeight: 15 },
  inlineError: { minHeight: 54, borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 },
  retryText: { marginTop: 4, fontSize: 12, fontWeight: '800' },
  peopleLoader: { marginVertical: 12 },
  peopleHeading: { minHeight: 44, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  peopleHeadingTitle: { flex: 1, fontSize: 13, fontWeight: '800' },
  peopleHeadingCount: { fontSize: 11, fontWeight: '700' },
  emptyBody: { minHeight: 220, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 10, fontSize: 16, fontWeight: '800' },
  emptyText: { marginTop: 4, textAlign: 'center', fontSize: 12, lineHeight: 17 },
  searchResult: { minHeight: 78, borderRadius: 15, borderWidth: 1, padding: 11, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resultBody: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  resultMeta: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  adminFallback: { minHeight: 84, borderRadius: 14, borderWidth: 1, padding: 12, marginTop: 4, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
