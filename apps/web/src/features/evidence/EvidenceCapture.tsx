import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import { formatBytes, processImage, readPosition, type CapturedImage } from '@/lib/media/capture';
import { db, storagePressure } from '@/lib/offline/db';
import { enqueue } from '@/lib/offline/outbox';
import { sync } from '@/lib/offline/sync';

export type EvidenceStage = 'BEFORE' | 'DURING' | 'AFTER' | 'BASELINE' | 'ROUTINE';

interface Props {
  facilityId: string;
  /** Pre-fills the description with the question being evidenced. */
  context?: string;
  defaultStage?: EvidenceStage;
  onCaptured: (evidenceId: string) => void;
  onClose: () => void;
}

/**
 * Capture a photograph as evidence.
 *
 * The flow is built around one fact: the assessor is standing in front of the
 * thing being photographed, probably outdoors, probably in a hurry.
 *
 *  - The camera opens directly (`capture="environment"`), not a file browser.
 *  - The image is compressed BEFORE it is stored, so 200 photographs do not
 *    fill the device.
 *  - Location is opt-in and explained. Re-encoding strips the EXIF GPS that
 *    phones embed silently, so the only coordinates recorded are ones the
 *    assessor chose to attach.
 *  - Everything is written locally first. Nothing here requires a network.
 */
export function EvidenceCapture({
  facilityId,
  context,
  defaultStage = 'BASELINE',
  onCaptured,
  onClose,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [description, setDescription] = useState(context ?? '');
  const [stage, setStage] = useState<EvidenceStage>(defaultStage);
  const [attachLocation, setAttachLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();

    void storagePressure().then((pressure) => {
      if (pressure?.blockCapture) {
        setBlocked(
          'This device is out of storage. Sync to free space before taking more photographs — otherwise they would be lost.',
        );
      }
    });

    return () => {
      // The preview URL is revoked here rather than on submit, because the
      // dialog can also be dismissed.
      if (image) URL.revokeObjectURL(image.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);

    try {
      if (image) URL.revokeObjectURL(image.previewUrl);
      setImage(await processImage(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That image could not be processed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!image) return;

    setBusy(true);
    setError(null);

    try {
      const evidenceId = crypto.randomUUID();
      const position = attachLocation ? await readPosition() : null;

      // The bytes go to the local store first, and upload on their own channel.
      // The assessment is complete and reportable before they finish.
      await db.media.put({
        evidenceId,
        facilityId,
        blob: image.blob,
        contentType: image.contentType,
        sizeBytes: image.sizeBytes,
        contentHash: image.contentHash,
        status: 'PENDING_UPLOAD',
        attempts: 0,
        createdAt: new Date().toISOString(),
      });

      await enqueue({
        id: evidenceId,
        entity: 'evidence',
        op: 'create',
        path: '/evidence',
        payload: {
          id: evidenceId,
          facilityId,
          source: 'PHOTOGRAPH',
          description: description.trim() || undefined,
          capturedOn: new Date().toISOString(),
          stage,
          media: {
            fileName: `${evidenceId}.webp`,
            contentType: image.contentType,
            sizeBytes: image.sizeBytes,
            contentHash: image.contentHash,
            width: image.width,
            height: image.height,
          },
          ...(position ?? {}),
        },
      });

      if (navigator.onLine) void sync();

      onCaptured(evidenceId);
      dialogRef.current?.close();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The photograph could not be saved.');
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        dialogRef.current?.close();
        onClose();
      }}
      aria-labelledby="evidence-title"
    >
      <div className="stack">
        <h2 id="evidence-title">Attach evidence</h2>

        {blocked && <div className="notice notice-danger">{blocked}</div>}

        {!blocked && (
          <>
            <div className="field">
              <label className="label" htmlFor="evidence-file">
                Photograph
              </label>
              <input
                id="evidence-file"
                className="input"
                type="file"
                accept="image/*"
                /* Opens the camera directly on a phone rather than a file
                   browser — the assessor is standing in front of the subject. */
                capture="environment"
                onChange={(event) => void onFile(event)}
              />
            </div>

            {image && (
              <div className="stack" style={{ '--gap': 'var(--s2)' } as React.CSSProperties}>
                <img
                  src={image.previewUrl}
                  alt="The photograph just captured"
                  style={{ width: '100%', borderRadius: 'var(--radius)', display: 'block' }}
                />
                <p className="tiny muted" style={{ margin: 0 }}>
                  {image.width}×{image.height} · {formatBytes(image.sizeBytes)}
                  {image.originalSizeBytes > image.sizeBytes && (
                    <> · reduced from {formatBytes(image.originalSizeBytes)}</>
                  )}
                </p>
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="evidence-description">
                What does this show?
              </label>
              <textarea
                id="evidence-description"
                className="textarea"
                value={description}
                placeholder="Water ingress above the labour room door"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="field">
              <span className="label">Stage</span>
              <p className="hint">
                Before and after photographs are paired in reports, which is how an intervention is
                shown to have worked.
              </p>
              <div className="choice-group choice-group-inline">
                {(['BEFORE', 'BASELINE', 'AFTER'] as const).map((option) => (
                  <label key={option} className="choice">
                    <input
                      type="radio"
                      name="stage"
                      checked={stage === option}
                      onChange={() => setStage(option)}
                    />
                    <span className="small">{option.charAt(0) + option.slice(1).toLowerCase()}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="choice">
              <input
                type="checkbox"
                checked={attachLocation}
                onChange={(event) => setAttachLocation(event.target.checked)}
              />
              <span className="small">
                Attach this location
                <span className="muted"> — optional, and only recorded if you tick this</span>
              </span>
            </label>

            {error && (
              <div className="notice notice-danger" role="alert">
                {error}
              </div>
            )}
          </>
        )}

        <div className="row-between">
          <button
            type="button"
            className="btn"
            onClick={() => {
              dialogRef.current?.close();
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!image || busy || Boolean(blocked)}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Attach'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
