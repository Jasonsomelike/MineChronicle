import { Modal } from 'antd';
import { X, ImageIcon } from 'lucide-react';
import type { StatResource } from '../lib/activity';
import { iconUrl } from '../lib/runtimeResources';

export interface IconSelection {
  label: string;
  icon: NonNullable<StatResource['icon']>;
}

/**
 * One stat icon, larger, with its provenance.
 *
 * The hand-written <dialog> became an antd Modal, following the pattern
 * `SessionEndDialog` established for this migration: a controlled Modal with no
 * mount-time effects (so the StrictMode remount dance the native element forced
 * is gone - `showModal` had to run in an effect whose cleanup fired `close`),
 * and motion disabled because the app's reduced-motion reset strips the very
 * transition events antd's leave animation waits for, which left the closing
 * dialog half-invisible. The parent still unmounts on close; Escape and the
 * mask funnel through `onCancel` exactly as the native element's `cancel` and
 * the backdrop click did. The `.stat-image-*` classes and the autofocus close
 * button carry over unchanged.
 */
export default function StatIconPreview({
  selection,
  onClose,
}: {
  selection: IconSelection;
  onClose: () => void;
}) {
  const { icon, label } = selection;
  return (
    <Modal
      open
      /* The native dialog's width cap, carried over verbatim. */
      width="min(440px, calc(100% - 32px))"
      className="stat-image-dialog"
      aria-label={`${label}图标`}
      footer={null}
      closable={false}
      /* The native dialog had no title bar; the header inside the body - heading
         plus the autofocus close button - is the dialog's own chrome, kept
         as-is. */
      transitionName=""
      maskTransitionName=""
      maskClosable
      keyboard
      onCancel={onClose}
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
    </Modal>
  );
}
