interface Props {
  sessionId: string;
  onClose: () => void;
}

export function SubmitDrawer({ onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white dark:bg-gray-950 h-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Submit review</h2>
        <p className="text-sm text-gray-500 mt-2">Submit drawer not yet wired (Phase 21).</p>
      </div>
    </div>
  );
}
