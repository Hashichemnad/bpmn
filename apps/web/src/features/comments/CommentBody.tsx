import { commentSegments } from '@processhub/shared';

/** Renders a comment as text; mentions are highlighted. Never interpreted as HTML. */
export function CommentBody({ body }: { body: string }) {
  return (
    <div className="ph-comment-body" dir="auto">
      {commentSegments(body).map((s, i) =>
        s.type === 'text' ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span key={i} className="ph-mention">
            @{s.name}
          </span>
        ),
      )}
    </div>
  );
}
