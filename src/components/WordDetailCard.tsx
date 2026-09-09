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
import type { SubtitleLang } from '../types';
import { lookupWord, type WordDefinition } from '../utils/dictionary';
import { speak } from '../utils/tts';

interface WordDetailCardProps {
  word: string;
  sentence: string;
  lang: SubtitleLang;
  isCollected: boolean;
  onClose: () => void;
  onCollect: () => void;
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

  const handleSpeak = (): void => {
    speak(word, { lang: 'en-US', rate: 0.85 });
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
        </Box>

        <Divider />

        <CardContent sx={{ pt: 1.5, pb: 1.5 }}>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              variant="outlined"
              size="small"
              onClick={isCollected ? onUncollect : onCollect}
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
