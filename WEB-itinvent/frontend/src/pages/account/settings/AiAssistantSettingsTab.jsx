import { Grid } from '@mui/material';
import AiPersonalMemoryManager from '../../../components/chat/AiPersonalMemoryManager';
import useAiPersonalMemory from '../../../components/chat/useAiPersonalMemory';
import SectionCard from '../shared/SectionCard';

// AG: the user's own AI settings. The personal memory is managed here as in ChatGPT
// (switch, list of remembered facts, delete one, clear all); the same block is in the
// conversation panel.
export default function AiAssistantSettingsTab() {
  const memory = useAiPersonalMemory({ available: true });
  return (
    <Grid container spacing={1.25} sx={{ minHeight: 0 }}>
      <Grid item xs={12}>
        <SectionCard
          title="Личная память ассистента"
          description="Предпочтения и рабочие факты, которые HUB Ассистент помнит между диалогами. Если ответ их учёл, под ним стоит пометка «Учтена личная память»."
          contentSx={{ p: 1.5 }}
        >
          <AiPersonalMemoryManager memory={memory} available />
        </SectionCard>
      </Grid>
    </Grid>
  );
}
