'use client';
import React, { useState, useCallback, useEffect } from 'react';
import './folder-transfer.css';

/**
 * FolderTransfer
 * --------------
 * Animated "folder → server" illustration.
 *  - Idle: closed folder, document cards tucked inside the pocket, data streaks
 *    flowing along dashed lines ONLY between the folder and the server.
 *  - Hover (desktop) / tap (touch) / Enter or Space (keyboard): the front flap
 *    drops and the cards rise out of the pocket (they stay between the
 *    folder's back panel and its front flap).
 *
 * Sized in container-query units (cqw) so the scene scales with its parent's width (phones → desktop).
 *
 * Props
 *  - images:   up to 3 image URLs for the cards (tasteful representations of a PDF, a presentation,
 *              and a text document if omitted)
 *  - autoPlay: ms interval to toggle open/closed automatically (0 = off);
 *              stops after the first user interaction
 *  - className / style: forwarded to the outer wrapper
 */

// y positions (cqw) + timing for each rail — all inside the folder's height (20.9–37.4cqw) so every line touches both folder and server
const RAILS = [
  { y: 22.4, d: 2.7, delay: 0.3 },
  { y: 25.6, d: 2.2, delay: 1.2 },
  { y: 28.8, d: 3.1, delay: 0.7 },
  { y: 32.0, d: 2.5, delay: 1.9 },
  { y: 35.2, d: 2.9, delay: 0.0 },
];

function renderDocCard(index) {
  if (index === 0) {
    // Card 1: PDF Document (academic notes / paper)
    return (
      <span className="ft-doc ft-doc-pdf">
        <span className="ft-doc-header">
          <span className="ft-badge ft-badge-pdf">PDF</span>
          <span className="ft-doc-name">Syllabus.pdf</span>
        </span>
        <span className="ft-doc-body">
          <span className="ft-doc-title ft-title-pdf" />
          <span className="ft-doc-line ft-w-90" />
          <span className="ft-doc-line ft-w-75" />
          <span className="ft-doc-line ft-w-85" />
        </span>
        <span className="ft-doc-figure">
          <span className="ft-doc-fig-bar" />
          <span className="ft-doc-fig-dots">
            <i /><i /><i />
          </span>
        </span>
      </span>
    );
  }
  if (index === 1) {
    // Card 2: Presentation Deck (slides)
    return (
      <span className="ft-doc ft-doc-deck">
        <span className="ft-doc-header">
          <span className="ft-badge ft-badge-deck">SLIDES</span>
          <span className="ft-deck-dots">
            <i /><i /><i />
          </span>
        </span>
        <span className="ft-deck-body">
          <span className="ft-deck-left">
            <span className="ft-doc-title ft-title-deck" />
            <span className="ft-deck-bullet">
              <i className="ft-deck-point" />
              <span className="ft-doc-line ft-w-80" />
            </span>
            <span className="ft-deck-bullet">
              <i className="ft-deck-point" />
              <span className="ft-doc-line ft-w-65" />
            </span>
          </span>
          <span className="ft-deck-right">
            <span className="ft-deck-chart">
              <i className="ft-chart-bar ft-h-45" />
              <i className="ft-chart-bar ft-h-90" />
              <i className="ft-chart-bar ft-h-65" />
            </span>
          </span>
        </span>
        <span className="ft-doc-footer">
          <span className="ft-doc-name">Lecture_04.key</span>
        </span>
      </span>
    );
  }
  // Card 3: Text Document (Zenote notes with signature highlight)
  return (
    <span className="ft-doc ft-doc-notes">
      <span className="ft-doc-header">
        <span className="ft-badge ft-badge-notes">DOC</span>
        <span className="ft-doc-name">Summary.md</span>
      </span>
      <span className="ft-doc-body">
        <span className="ft-doc-title ft-title-notes" />
        <span className="ft-doc-line ft-w-90" />
        {/* Signature Zenote Highlighter Mark */}
        <span className="ft-highlight-line">
          <span className="ft-doc-line ft-w-80" />
        </span>
        <span className="ft-doc-line ft-w-70" />
        <span className="ft-check-line">
          <i className="ft-check-box" />
          <span className="ft-doc-line ft-w-60" />
        </span>
      </span>
    </span>
  );
}

export default function FolderTransfer({ images = [], autoPlay = 0, className = '', style }) {
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!autoPlay || touched) return;
    const id = setInterval(() => setOpen((o) => !o), autoPlay);
    return () => clearInterval(id);
  }, [autoPlay, touched]);

  const onEnter = useCallback((e) => { if (e.pointerType === 'mouse') setOpen(true); }, []);
  const onLeave = useCallback((e) => { if (e.pointerType === 'mouse') setOpen(false); }, []);
  const onClick = useCallback(() => { setTouched(true); setOpen((o) => !o); }, []);

  return (
    <div className={`ft-wrap ${className}`} style={style}>
      <div className={`ft-stage ${open ? 'is-open' : ''}`}>
        <div className="ft-scene">
          {/* rails + streaks: clipped to the gap between folder and server */}
          <div className="ft-link" aria-hidden="true">
            {RAILS.map((r, i) => (
              <React.Fragment key={i}>
                <div className="ft-rail" style={{ top: `${r.y}cqw` }} />
                <div className="ft-streak" style={{ top: `${r.y}cqw`, '--d': `${r.d}s`, '--delay': `${r.delay}s` }} />
              </React.Fragment>
            ))}
          </div>

          {/* folder */}
          <button
            type="button"
            className={`ft-folder ${open ? 'is-open' : ''}`}
            aria-label="Interactive folder containing study materials and documents"
            aria-pressed={open}
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
            onClick={onClick}
          >
            <span className="ft-back" />
            <span className="ft-pocket" />
            {[0, 1, 2].map((i) => (
              <span key={i} className={`ft-card ft-c${i + 1}`}>
                {images[i] ? (
                  <img src={images[i]} alt="" draggable={false} />
                ) : (
                  renderDocCard(i)
                )}
              </span>
            ))}
            <span className="ft-front" />
          </button>

          {/* server */}
          <div className="ft-server" aria-hidden="true">
            <div className="ft-slot"><span className="ft-ticks" /><span className="ft-led" /></div>
            <div className="ft-bay b1" />
            <div className="ft-bay b2" />
          </div>
        </div>
      </div>
    </div>
  );
}
