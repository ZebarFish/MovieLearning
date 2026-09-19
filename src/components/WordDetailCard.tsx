/**
 * WordDetailCard
 *
 * A modal card shown when the user clicks an English word in the subtitle
 * list. It fetches IPA / definitions from the Free Dictionary API and lets
 * the user listen to the word or add it to their vocabulary.
 */
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Modal,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import type { SubtitleLang, WordMeta } from '../types';
import { formatDefinition, lookupWord, type WordDefinition } from '../utils/dictionary';
import { formatForms, metaBadges, toWordMeta } from '../utils/wordMeta';
import { speak } from '../utils/tts';

interface WordDetailCardProps {
  word: string;
  sentence: string;
  lang: SubtitleLang;
  isCollected: boolean;
  onClose: () => void;
  /**
   * `definition` is the 单词释义 shown here and `meta` the extra lexical
   * metadata — handing both over means the collected entry needs no second
   * lookup before it can be written into Anki.
   */
  onCollect: (definition?: string, meta?: WordMeta) => void;
  onUncollect: () => void;
}

export function WordDetailCard({
  word,
  sentence,
  lang,
  isCollected,
  onClose,
  onCollect,
  onUncollect,
}: WordDetailCardProps): JSX.Element {
  const [def, setDef] = useState<WordDefinition | null | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDef(undefined);
    lookupWord(word).then((result) => {
      if (cancelled) return;
      setDef(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [word]);

  const badges = def ? metaBadges(def.meta) : [];
  const forms = def ? formatForms(def.meta) : '';

  const handleSpeak = (): void => {
    speak(word, { lang: 'en-US', rate: 0.85 });
  };

  // Hand the definition and metadata we already fetched to the vocabulary
  // entry, so the Anki card's 单词释义 / 音标 / 词形变化 / 词汇标记 fields are
  // populated without a second lookup.
  const handleCollect = (): void => {
    onCollect(
      def ? formatDefinition(def) || undefined : undefined,
      def ? toWordMeta(def) : undefined,
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      aria-labelledby="word-detail-title"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      data-testid="word-detail-card"
    >
      <Card
        elevation={4}
        sx={{
          width: { xs: '90vw', sm: 440 },
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <CardContent sx={{ pb: 1 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="flex-start"
            justifyContent="space-between"
          >
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography id="word-detail-title" variant="h5" sx={{ fontWeight: 600 }}>
                  {word}
                </Typography>
                <Tooltip title="朗读单词">
                  <IconButton size="small" onClick={handleSpeak} color="primary">
                    <VolumeUpIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
              {loading && (
                <Box sx={{ mt: 1 }}>
                  <CircularProgress size={18} />
                </Box>
              )}
              {!loading && def?.phonetic && (
                <Typography
                  variant="body1"
                  color="text.secondary"
                  sx={{ mt: 0.5, fontFamily: 'Georgia, serif' }}
                >
                  {def.phonetic}
                </Typography>
              )}
              {!loading && badges.length > 0 && (
                <Stack
                  direction="row"
                  spacing={0.5}
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mt: 0.75 }}
                  data-testid="word-meta-badges"
                >
                  {badges.map((badge) => (
                    <Chip
                      key={badge}
                      label={badge}
                      size="small"
                      variant="outlined"
                    />
                  ))}
                </Stack>
              )}
              {!loading && forms && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.75, lineHeight: 1.5 }}
                  data-testid="word-forms"
                >
                  {forms}
                </Typography>
              )}
              {!loading && def && def.queried && def.queried !== def.word && (
                <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.5 }}>
                  「{def.queried}」是「{def.word}」的变形,以下为原形释义
                </Typography>
              )}
              {!loading && def === null && (
                <Typography variant="caption" color="text.secondary">
                  未找到该词释义(可能是专有名词或拼写特殊)
                </Typography>
              )}
            </Box>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </CardContent>

        <Divider />

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            例句
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontStyle: 'italic',
              color: 'text.secondary',
              mb: 2,
              lineHeight: 1.6,
            }}
          >
            “{sentence}”
          </Typography>

          {def && def.meanings.length > 0 && (
            <>
              <Typography variant="subtitle2" gutterBottom>
                释义
              </Typography>
              <Stack spacing={1.5}>
                {def.meanings.map((m) => (
                  <Box key={m.partOfSpeech}>
                    <Chip
                      label={m.partOfSpeech}
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ mb: 0.5 }}
                    />
                    <Box component="ul" sx={{ pl: 2, m: 0 }}>
                      {m.definitions.map((d, idx) => (
                        <Typography
                          component="li"
                          variant="body2"
                          key={idx}
                          sx={{ mb: 0.25, lineHeight: 1.5 }}
                        >
                          {d}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Stack>
            </>
          )}

          {def?.meta?.definition && (
            <>
              <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
                英文释义
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  color: 'text.secondary',
                  lineHeight: 1.6,
                }}
                data-testid="word-en-definition"
              >
                {def.meta.definition}
              </Typography>
            </>
          )}
        </Box>

        <Divider />

        <CardContent sx={{ pt: 1.5, pb: 1.5 }}>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              variant="outlined"
              size="small"
              onClick={isCollected ? onUncollect : handleCollect}
              color={isCollected ? 'secondary' : 'primary'}
            >
              {isCollected ? '⭐ 已收藏' : '☆ 收藏'}
            </Button>
            <Button variant="text" size="small" onClick={onClose}>
              关闭
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Modal>
  );
}
