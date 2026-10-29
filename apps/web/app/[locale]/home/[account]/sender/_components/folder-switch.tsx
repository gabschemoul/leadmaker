'use client';

import { useRouter } from 'next/navigation';

import { NativeSelect, NativeSelectOption } from '@kit/ui/native-select';

/**
 * Choix du dossier client (affiché seulement quand l'organisation en a
 * plusieurs) : le dossier choisi est écrit dans l'URL, la page se recharge.
 */
export function FolderSwitch(props: {
  basePath: string;
  folders: Array<{ id: string; label: string }>;
  value: string;
}) {
  const router = useRouter();

  return (
    <NativeSelect
      className={'w-full max-w-xs'}
      data-test={'sender-folder-select'}
      value={props.value}
      onChange={(event) =>
        router.push(`${props.basePath}?space=${event.target.value}`)
      }
    >
      {props.folders.map((folder) => (
        <NativeSelectOption key={folder.id} value={folder.id}>
          {folder.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
