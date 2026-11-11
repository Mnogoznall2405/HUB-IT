import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { createNativeChatDraftWriter, type NativeChatDraftContext } from './chatDrafts';
import { pinNativeChatDraftFiles, deleteUnreferencedChatFiles } from './nativeChatDraftFiles';
import { enqueueNativeChatStorage } from './nativeChatStorageQueue';

/** Coalesce typing, but flush the latest scheduled text when leaving the editor. */
export function useNativeChatDraftAutosave(
  userId: number,
  conversationId: string,
  text: string,
  enabled: boolean,
  onResult: (error: unknown | null) => void,
  context?: NativeChatDraftContext,
) {
  const contextKey = JSON.stringify(context ?? null);
  const stableContext = useMemo(() => context, [contextKey]); // Context values, not render identity, define a revision.
  const fingerprint = JSON.stringify([text, contextKey]);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const editor = useMemo(() => ({
    write: createNativeChatDraftWriter(userId, conversationId),
    pending: null as { text: string; context?: NativeChatDraftContext } | null,
    revision: 0,
    active: true,
    inFlight: null as Promise<boolean> | null,
    inFlightText: null as string | null,
    unpin: [] as Array<() => void>,
    fileUris: new Set<string>(),
  }), [userId, conversationId]);
  useLayoutEffect(() => {
    const files = stableContext?.files || [];
    if (files.length) {
      editor.unpin.push(pinNativeChatDraftFiles(files));
      files.forEach((file) => editor.fileUris.add(file.uri));
    }
  }, [editor, stableContext]);
  const [saved, setSaved] = useState<{ editor: typeof editor; fingerprint: string; revision: number } | null>(null);
  const saveNow = useCallback((): Promise<boolean> => {
    if (!enabled || !userId || !editor.active) return Promise.resolve(false);
    const revision = editor.revision;
    if (editor.inFlight) {
      if (editor.inFlightText === fingerprint) return editor.inFlight;
      return editor.inFlight.then(() => editor.active && editor.revision === revision ? saveNow() : false);
    }
    editor.inFlightText = fingerprint;
    const operation = editor.write(text, stableContext).then(() => {
      if (editor.active && revision === editor.revision) {
        editor.pending = null;
        setSaved({ editor, fingerprint, revision });
        onResultRef.current(null);
      }
      return true;
    }).catch((error: unknown) => {
      if (editor.active && revision === editor.revision) onResultRef.current(error);
      return false;
    }).finally(() => { editor.inFlight = null; });
    editor.inFlight = operation;
    return operation;
  }, [editor, enabled, text, userId, stableContext, fingerprint]);

  const lifecycle = useMemo(() => ({ flush: () => {} }), [editor]);
  useLayoutEffect(() => {
    lifecycle.flush = () => { if (editor.pending !== null) void saveNow(); };
  }, [editor, lifecycle, saveNow]);
  useFocusEffect(useCallback(() => () => lifecycle.flush(), [lifecycle]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'inactive' || state === 'background') lifecycle.flush();
    });
    return () => subscription.remove();
  }, [lifecycle]);

  useEffect(() => {
    editor.active = true;
    return () => {
      editor.active = false;
      const unpinFiles = editor.unpin.splice(0);
      const fileUris = [...editor.fileUris];
      const release = (cleanup: boolean) => {
        unpinFiles.forEach((unpin) => unpin());
        if (cleanup && fileUris.length) {
          void enqueueNativeChatStorage(() => deleteUnreferencedChatFiles(fileUris)).catch(() => undefined);
        }
      };
      if (editor.pending !== null) {
        const pending = editor.pending;
        editor.pending = null;
        // The view has gone; preserve the previous stored copy on failure.
        void editor.write(pending.text, pending.context).then(() => release(true), () => release(false));
      } else if (editor.inFlight) void editor.inFlight.then(release);
      else release(true);
    };
  }, [editor]);

  useEffect(() => {
    if (!enabled || !userId) return;
    ++editor.revision;
    editor.pending = { text, context: stableContext };
    const timer = setTimeout(() => {
      void saveNow();
    }, 350);
    return () => { clearTimeout(timer); editor.revision += 1; };
  }, [editor, enabled, text, userId, saveNow, stableContext]);
  return { saveNow, saved: saved?.editor === editor && saved.fingerprint === fingerprint && saved.revision === editor.revision };
}
