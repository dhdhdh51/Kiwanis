import { useQueryClient } from '@tanstack/react-query';
import { Download, FolderInput, Info, Link2, MoreVertical, Pencil, Play, Share2, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Menu } from '../ui/Menu';
import { copyShareLink, downloadVideos, trashVideos } from '../../lib/actions';
import type { Video } from '../../lib/types';
import { ui } from '../../lib/ui';

export function VideoMenu({ video, className }: { video: Video; className?: string }) {
  const qc = useQueryClient();
  return (
    <Menu
      items={[
        { label: 'Play', icon: <Play size={16} />, onClick: () => ui.play(video) },
        { label: 'Download', icon: <Download size={16} />, onClick: () => downloadVideos([video]) },
        { label: 'Rename', icon: <Pencil size={16} />, onClick: () => ui.rename(video), divider: true },
        { label: 'Share', icon: <Share2 size={16} />, onClick: () => ui.share([video]) },
        { label: 'Copy link', icon: <Link2 size={16} />, onClick: () => copyShareLink(video, qc) },
        { label: 'Move to folder', icon: <FolderInput size={16} />, onClick: () => ui.move([video]) },
        { label: 'View details', icon: <Info size={16} />, onClick: () => ui.details(video) },
        { label: 'Delete', icon: <Trash2 size={16} />, onClick: () => trashVideos([video], qc), danger: true, divider: true },
      ]}
      trigger={(p) => (
        <button {...p} className={clsx('btn-icon h-8 w-8 rounded-lg', className)} aria-label={`Actions for ${video.filename}`}>
          <MoreVertical size={18} />
        </button>
      )}
    />
  );
}
