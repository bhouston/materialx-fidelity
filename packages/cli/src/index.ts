import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';

export async function runCli(argv = hideBin(process.argv)): Promise<void> {
  const commandsDir = fileURLToPath(new URL('./commands', import.meta.url));
  const commandModules = await fileCommands({
    commandDirs: [commandsDir],
    validation: true,
  });

  await yargs(argv)
    .scriptName('mtlx-fidelity')
    .usage('$0 <command>')
    .command(commandModules)
    .strictCommands()
    .demandCommand(1)
    .help()
    .parseAsync();
}
