/**
 * The three writes every command is given.
 *
 * One definition, in a module that imports nothing: every command takes these,
 * so nothing has to reach into a command's own module for the interface.
 */
export interface Streams {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  isTTY: boolean;
}
