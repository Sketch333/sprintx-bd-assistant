// Deliberately render plain text: model output and stored history are untrusted.
// Preserve headings, lists and citations as written without an HTML/Markdown parser.
export function AnswerContent({ content }: { content: string }) {
  return <p className="answer">{content}</p>;
}
