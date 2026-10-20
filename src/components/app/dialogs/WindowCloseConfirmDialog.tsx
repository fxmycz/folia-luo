import React from 'react';
import ThemedDialog from '../../shared/ThemedDialog';

// src/components/app/dialogs/WindowCloseConfirmDialog.tsx

export interface WindowCloseConfirmDialogProps {
    isOpen: boolean;
    isDaylight?: boolean;
    title: string;
    description: string;
    /** Cancel: do nothing at all - the window stays where it is and this close attempt is dropped. */
    cancelText: string;
    /** Hide the window to the tray (main falls back to closing it when there is no tray icon). */
    hideText: string;
    /** Quit the whole app; the main process's before-quit takes the tray icon down with it. */
    quitText: string;
    onCancel: () => void;
    onHide: () => void;
    onQuit: () => void;
}

/**
 * The titlebar X's confirmation. Three choices, deliberately: cancel (nothing happens), hide the
 * window, quit the app - only the last one ends the session, so a stray click cannot.
 *
 * ThemedDialog is reused for the shell alone: card, backdrop and enter/exit motion are then the same
 * ones the settings and wallpaper dialogs use. The three-button footer is unique to this dialog,
 * which is why it is not the two-button ConfirmDialog with a third button bolted on.
 */
const WindowCloseConfirmDialog: React.FC<WindowCloseConfirmDialogProps> = ({
    isOpen,
    isDaylight = false,
    title,
    description,
    cancelText,
    hideText,
    quitText,
    onCancel,
    onHide,
    onQuit,
}) => {
    // Cancel and Hide read as the two quiet choices, so they share a look; Quit is the red one.
    const neutralClass = isDaylight
        ? 'bg-zinc-100/80 hover:bg-zinc-200 border-zinc-200 text-zinc-700'
        : 'bg-white/5 hover:bg-white/10 border-white/10 text-white';

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onCancel}
            isDaylight={isDaylight}
            title={title}
            description={description}
            footer={(
                <>
                    <button
                        type="button"
                        onClick={onCancel}
                        className={`rounded-full border px-5 py-2.5 text-sm font-medium transition-colors ${neutralClass}`}
                    >
                        {cancelText}
                    </button>
                    <button
                        type="button"
                        onClick={onHide}
                        className={`rounded-full border px-5 py-2.5 text-sm font-medium transition-colors ${neutralClass}`}
                    >
                        {hideText}
                    </button>
                    <button
                        type="button"
                        onClick={onQuit}
                        className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-500/20 transition-colors hover:bg-red-600"
                    >
                        {quitText}
                    </button>
                </>
            )}
        >
            {null}
        </ThemedDialog>
    );
};

export default WindowCloseConfirmDialog;
