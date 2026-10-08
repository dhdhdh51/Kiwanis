import { useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useUi } from '../../lib/ui';

/** Full-window drag-and-drop target: drop files anywhere in the app to start an upload. */
export function DropOverlay() {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || useUi.getState().uploadDialog) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const st = useUi.getState();
      if (!files.length || st.uploadDialog) return;
      st.set({ uploadDialog: { files, folderId: st.currentFolderId } });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] flex animate-fade-in items-center justify-center bg-brand-600/15 p-6 backdrop-blur-sm">
      <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-brand-500 bg-white/90 px-14 py-12 text-center shadow-2xl dark:bg-[#15151f]/90">
        <UploadCloud size={48} className="mb-3 text-brand-500" />
        <p className="text-lg font-semibold">Drop videos to upload</p>
        <p className="mt-1 text-sm text-zinc-500">You'll be able to review them before the upload starts</p>
      </div>
    </div>
  );
}
