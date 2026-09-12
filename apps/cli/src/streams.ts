/**
 * The three writes every command is given.
 *
 * One definition, in a module that imports nothing: both entry points and every
 * command in either of them take these, so the interface cannot live in a file
 * that only one of the two builds is allowed to link against.
 */
export interface Streams {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  isTTY: boolean;
}
