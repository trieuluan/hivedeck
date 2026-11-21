export type ArtifactFile = {
  path: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
};

export function artifactGroups(
  artifacts: Record<string, ArtifactFile[]>,
  sort: 'date' | 'size'
) {
  return Object.entries(artifacts)
    .map(([issueId, files]) => ({
      issueId,
      files,
      total: files.reduce((sum, file) => sum + file.size, 0),
      latest: files.reduce(
        (latest, file) =>
          !latest || Date.parse(file.created_at) > Date.parse(latest)
            ? file.created_at
            : latest,
        ''
      ),
      image: files.find((file) => file.mime.startsWith('image/')),
    }))
    .sort((first, second) =>
      sort === 'size'
        ? second.total - first.total
        : (Date.parse(second.latest) || 0) - (Date.parse(first.latest) || 0)
    );
}
