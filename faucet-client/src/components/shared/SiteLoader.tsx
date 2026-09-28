import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import './SiteLoader.scss';

const MIN_VISIBLE_MS = 1500;
const MAX_VISIBLE_MS = 8000;
const FADE_MS = 500;
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
let shellReady = false;
const shellReadyListeners = new Set<() => void>();

export function markSplashShellReady() {
  if(shellReady) return;
  shellReady = true;
  for(const listener of shellReadyListeners) listener();
  shellReadyListeners.clear();
}

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function unlockContent() {
  const content = document.getElementById('app-content');
  content?.removeAttribute('inert');
  content?.removeAttribute('aria-hidden');
}

function endGate() {
  document.documentElement.removeAttribute('data-splash');
  unlockContent();
}

export function SiteLoader() {
  const reduced = useSyncExternalStore(subscribeMotion,
    () => window.matchMedia(MOTION_QUERY).matches, () => false);
  const reducedRef = useRef(reduced);
  useEffect(() => { reducedRef.current = reduced; }, [reduced]);
  const [phase, setPhase] = useState<'cover' | 'fade' | 'done'>('cover');

  useEffect(() => {
    if(!document.documentElement.dataset.splash) {
      setPhase('done');
      return;
    }
    const content = document.getElementById('app-content');
    content?.setAttribute('inert', '');
    content?.setAttribute('aria-hidden', 'true');
    let cancelled = false;
    let revealed = false;
    let minElapsed = false;
    let fadeTimer: number;
    const reveal = () => {
      if(cancelled || revealed) return;
      revealed = true;
      if(reducedRef.current) {
        endGate();
        setPhase('done');
      } else {
        setPhase('fade');
        fadeTimer = window.setTimeout(() => {
          endGate();
          setPhase('done');
        }, FADE_MS);
      }
    };
    const ready = () => { if(minElapsed) reveal(); };
    shellReadyListeners.add(ready);
    const holdTimer = window.setTimeout(() => {
      minElapsed = true;
      if(shellReady) reveal();
    }, MIN_VISIBLE_MS);
    const maxTimer = window.setTimeout(reveal, MAX_VISIBLE_MS);
    return () => {
      cancelled = true;
      shellReadyListeners.delete(ready);
      window.clearTimeout(holdTimer);
      window.clearTimeout(maxTimer);
      window.clearTimeout(fadeTimer);
      unlockContent();
    };
  }, []);

  if(phase === 'done') return null;
  return <div className="site-splash" role="status" aria-label="Loading QMS" style={{
    opacity: phase === 'fade' ? 0 : 1,
    filter: phase === 'fade' ? 'blur(12px)' : 'blur(0px)',
    transition: `opacity ${FADE_MS}ms ease-out, filter ${FADE_MS}ms ease-out`,
    willChange: 'opacity, filter',
  }}><QmsDrawMark reduced={reduced} /></div>;
}

// The source loader's resolve variant: trace the mark, fill it, dissolve its outline.
function QmsDrawMark({ reduced }: { reduced: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    if(reduced) return;
    const path = pathRef.current;
    if(!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    const animation = path.animate([
      { strokeDashoffset: String(length) }, { strokeDashoffset: '0' },
    ], { duration: 900, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' });
    return () => animation.cancel();
  }, [reduced]);
  return <svg className="site-splash__mark" viewBox="0 0 209 209" aria-hidden="true" focusable="false">
    <path className="site-splash__fill" d={QMS_MARK_PATH} fill="currentColor" />
    <path ref={pathRef} className="site-splash__stroke" d={QMS_MARK_PATH} fill="none" stroke="currentColor" strokeWidth="2.177" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

const QMS_MARK_PATH = 'M93.8868 16.6904C93.8869 17.8425 94.8206 18.7762 95.9727 18.7764H112.663C113.815 18.7761 114.75 17.8424 114.75 16.6904V0H204.463C206.767 2.11435e-05 208.636 1.86754 208.636 4.17188V93.8828H191.944C190.792 93.883 189.859 94.8168 189.858 95.9688V112.66C189.859 113.812 190.792 114.746 191.944 114.746H208.636V204.463C208.635 206.767 206.767 208.635 204.463 208.635H114.75V191.94C114.75 190.788 113.815 189.855 112.663 189.854H95.9727C94.8205 189.854 93.8868 190.788 93.8868 191.94V208.631H4.17389C1.86968 208.635 0.000571839 206.767 6.10352e-05 204.463V114.747H16.6905C17.8427 114.747 18.7783 113.813 18.7784 112.661V95.9707C18.7784 94.8184 17.8428 93.8828 16.6905 93.8828H6.10352e-05V4.17188C0.000267035 1.86753 1.86949 0 4.17389 0H93.8868V16.6904ZM45.8184 45.8174V162.817H162.818V45.8174H45.8184Z';
