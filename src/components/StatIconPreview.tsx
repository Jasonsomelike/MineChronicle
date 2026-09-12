import { useEffect, useRef } from 'react';
import { X, ImageIcon } from 'lucide-react';
import type { StatResource } from '../lib/activity';
import { iconUrl } from '../lib/runtimeResources';

export interface IconSelection {
  label: string;
  icon: NonNullable<StatResource['icon']>;
}

export default function StatIconPreview({
  selection,
  onClose,
}: {
  selection: IconSelection;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { icon, label } = selection;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="stat-image-dialog"
      aria-label={`${label}图标`}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="stat-image-content">
        <div className="stat-image-heading">
          <h3>
            <ImageIcon size={18} />
            {label}
          </h3>
          <button
            type="button"
            className="icon-button"
            title="关闭"
            aria-label="关闭图标预览"
            onClick={onClose}
            autoFocus
          >
            <X size={18} />
          </button>
        </div>
        <div className="stat-image-stage">
          <img
            src={iconUrl(icon.image)}
            alt={label}
            width={icon.width ?? icon.size}
            height={icon.height ?? icon.size}
            className={icon.kind === 'item' ? 'pixel-texture' : undefined}
          />
        </div>
        <div className="stat-image-meta">
          <span>
            {icon.width ?? icon.size} × {icon.height ?? icon.size} px
          </span>
          <span>{icon.kind === 'item' ? '游戏物品材质' : '游戏模型图标'}</span>
        </div>
        <p className="stat-image-source">{icon.source}</p>
      </div>
    </dialog>
  );
}
