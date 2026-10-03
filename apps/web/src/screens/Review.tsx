/**
 * Review: the second look at every labelled photograph.
 *
 * Labels are made in a hurry, at the oche, between throws. This screen is where
 * they are checked sitting down: each photograph with its marks, whole and
 * undistorted, to fix, confirm or throw away. It exists because a training set
 * nobody can inspect is a training set nobody can trust — some of the first
 * photographs saved themselves, and some carry a model's guesses that landed on
 * the flight (issues #3, #5).
 *
 * A photograph confirmed here is recorded as `reviewed`, and that is exported.
 */

import { formatHit } from '@treblewise/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BoardOverlay } from '../components/BoardOverlay.js';
import { fill, useStrings } from '../i18n/index.js';
import { deleteFrame, listFrames, putFrame, readDart, type CapturedFrame, type LabelledDart } from '../storage/frames.js';
import { filterFrames, hasModelMarks, markedBy, modelsWithMarks, type ReviewFilter } from '../storage/review.js';
import { useMatchStore } from '../store/match.js';

const PAGE = 12;

function sameMarks(a: readonly LabelledDart[], b: readonly LabelledDart[]): boolean {
  return a.length === b.length && a.every((dart, i) => dart === b[i]);
}

export function Review() {
  const t = useStrings();
  const goHome = useMatchStore((s) => s.goHome);

  const [frames, setFrames] = useState<CapturedFrame[] | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The marks as edited; saved back only by "Looks right". */
  const [marks, setMarks] = useState<LabelledDart[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setFrames(await listFrames(Number.MAX_SAFE_INTEGER));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const shown = useMemo(() => filterFrames(frames ?? [], filter), [frames, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = useMemo(() => shown.slice(current * PAGE, current * PAGE + PAGE), [shown, current]);
  const open = useMemo(() => (frames ?? []).find((frame) => frame.id === openId) ?? null, [frames, openId]);
  const models = useMemo(() => modelsWithMarks(frames ?? []), [frames]);

  // Object URLs only for what is on screen: a few hundred full-size JPEGs at
  // once is more memory than a phone has.
  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const frame of open ? [open] : visible) map.set(frame.id, URL.createObjectURL(frame.jpeg));
    return map;
  }, [visible, open]);
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls]);

  const openFrame = (frame: CapturedFrame) => {
    setOpenId(frame.id);
    setMarks(frame.darts);
    setConfirm(null);
  };

  const dirty = open !== null && !sameMarks(marks, open.darts);

  /** The neighbour in the filtered list, to move through them without the list. */
  const neighbour = (step: 1 | -1): CapturedFrame | null => {
    if (!open) return null;
    const index = shown.findIndex((frame) => frame.id === open.id);
    return index < 0 ? null : (shown[index + step] ?? null);
  };

  const saveOpen = async () => {
    if (!open || marks.length === 0) return;
    const next = neighbour(1);
    const stillModel = marks.some((dart) => dart.by === 'model');
    const { model: _model, ...rest } = open;
    await putFrame({
      ...rest,
      darts: marks,
      labelled: true,
      reviewed: true,
      // Once no mark of the model's is left standing, the frame is a person's.
      ...(stillModel && open.model ? { model: open.model } : {}),
    });
    await reload();
    if (next) openFrame(next);
    else setOpenId(null);
  };

  const deleteOpen = async () => {
    if (!open) return;
    const next = neighbour(1) ?? neighbour(-1);
    await deleteFrame(open.id);
    await reload();
    if (next) openFrame(next);
    else setOpenId(null);
  };

  const deleteByModel = async (model: string) => {
    if (confirm !== `model:${model}`) {
      setConfirm(`model:${model}`);
      return;
    }
    setConfirm(null);
    await Promise.all(markedBy(frames ?? [], model).map((frame) => deleteFrame(frame.id)));
    await reload();
  };

  if (frames === null) return <div className="screen screen-review" />;

  if (open) {
    const url = urls.get(open.id);
    return (
      <div className="screen screen-review">
        <header className="screen-head">
          <h1>{t.review.title}</h1>
          <p>{t.review.detailHelp}</p>
        </header>

        <div
          className="stage report-stage"
          style={{
            aspectRatio: `${open.width} / ${open.height}`,
            maxWidth: `calc((100vh - 300px) * ${(open.width / open.height).toFixed(4)})`,
          }}
        >
          {url && <img className="stage-frozen" src={url} alt="" />}
          <BoardOverlay
            width={open.width}
            height={open.height}
            toImage={open.calibration.toImage}
            darts={marks.map((dart, index) => ({
              img: dart.img,
              label: `${index + 1} · ${formatHit(dart.hit)}${dart.by === 'model' ? '?' : ''}`,
              kind: dart.by === 'model' ? ('proposed' as const) : ('new' as const),
            }))}
            onDartMove={(index, point) =>
              setMarks((list) => list.map((dart, i) => (i === index ? readDart(open.calibration, point) : dart)))
            }
            onTap={(point) => setMarks((list) => [...list, readDart(open.calibration, point)])}
          />
        </div>

        <div className="chip-row">
          {marks.map((dart, index) => (
            <button
              key={index}
              type="button"
              className="chip"
              aria-label={fill(t.review.removeMark, { n: index + 1 })}
              onClick={() => setMarks((list) => list.filter((_, i) => i !== index))}
            >
              {index + 1} · {formatHit(dart.hit)}
              {dart.by === 'model' ? ` (${t.review.byModel})` : ''} ×
            </button>
          ))}
        </div>
        <p className="hint">
          {open.reviewed ? t.review.alreadyReviewed : t.review.notReviewed}
          {dirty ? ` ${t.review.unsaved}` : ''}
        </p>

        <div className="controls">
          <button type="button" className="primary" onClick={() => void saveOpen()} disabled={marks.length === 0}>
            {t.review.looksRight}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => (confirm === 'delete' ? void deleteOpen() : setConfirm('delete'))}
          >
            {confirm === 'delete' ? t.review.deleteConfirm : t.review.deletePhoto}
          </button>
          {dirty && (
            <button type="button" className="chip" onClick={() => setMarks(open.darts)}>
              {t.review.discard}
            </button>
          )}
        </div>

        <div className="screen-actions">
          <button type="button" className="chip" disabled={dirty || !neighbour(-1)} onClick={() => openFrame(neighbour(-1)!)}>
            {t.review.previous}
          </button>
          <button type="button" className="chip" disabled={dirty || !neighbour(1)} onClick={() => openFrame(neighbour(1)!)}>
            {t.review.next}
          </button>
          <button type="button" className="chip" disabled={dirty} onClick={() => setOpenId(null)}>
            {t.review.backToList}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen screen-review">
      <header className="screen-head">
        <h1>{t.review.title}</h1>
        <p>{fill(t.review.subtitle, { n: frames.length, reviewed: frames.filter((frame) => frame.reviewed).length })}</p>
      </header>

      <div className="chip-row">
        {(['all', 'unreviewed', 'model'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`chip${filter === value ? ' chip-on' : ''}`}
            onClick={() => {
              setFilter(value);
              setPage(0);
            }}
          >
            {t.review.filters[value]} ({filterFrames(frames, value).length})
          </button>
        ))}
      </div>

      {models.length > 0 && (
        <section className="panel">
          <p className="hint">{t.review.modelHelp}</p>
          <div className="controls">
            {models.map(({ model, frames: count }) => (
              <button key={model} type="button" className="chip" onClick={() => void deleteByModel(model)}>
                {confirm === `model:${model}`
                  ? fill(t.review.deleteModelConfirm, { n: count })
                  : fill(t.review.deleteModel, { model, n: count })}
              </button>
            ))}
          </div>
        </section>
      )}

      {shown.length === 0 && <p className="hint">{t.review.empty}</p>}

      <ul className="review-grid">
        {visible.map((frame) => (
          <li key={frame.id}>
            <button type="button" className="review-card" onClick={() => openFrame(frame)}>
              <img src={urls.get(frame.id)} alt="" loading="lazy" style={{ aspectRatio: `${frame.width} / ${frame.height}` }} />
              <span className="review-card-line">
                {frame.darts.map((dart) => formatHit(dart.hit)).join(', ') || t.review.noMarks}
              </span>
              <span className="review-card-tags">
                {frame.source === 'game' ? t.review.fromGame : t.review.fromLab}
                {hasModelMarks(frame) ? ` · ${t.review.byModel}` : ''}
                {frame.reviewed ? ` · ${t.review.reviewedTag}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <div className="controls">
          <button type="button" className="chip" disabled={current === 0} onClick={() => setPage(current - 1)}>
            {t.review.previous}
          </button>
          <span className="hint">{fill(t.review.page, { n: current + 1, of: pages })}</span>
          <button type="button" className="chip" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            {t.review.next}
          </button>
        </div>
      )}

      <div className="screen-actions">
        <button type="button" className="chip" onClick={goHome}>
          {t.review.back}
        </button>
      </div>
    </div>
  );
}
