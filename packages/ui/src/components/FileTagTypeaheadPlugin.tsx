import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import {
  $createTextNode,
  $getRoot,
  $createParagraphNode,
  $isParagraphNode,
  KEY_ESCAPE_COMMAND,
  COMMAND_PRIORITY_NORMAL,
} from 'lexical';
import {
  TagIcon,
  FileTextIcon,
  GearIcon,
  PlusIcon,
  PuzzlePieceIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { useTypeaheadOpen } from './TypeaheadOpenContext';
import { TypeaheadMenu } from './TypeaheadMenu';

const MAX_FILE_RESULTS = 10;

type DiffFileResult = {
  path: string;
  name: string;
  is_file: boolean;
  match_type: 'FileName' | 'DirectoryName' | 'FullPath';
  score: bigint;
};

export type FileTagLike = {
  id: string | number;
  tag_name: string;
  content: string;
};

export type FileResultLike = {
  path: string;
  name: string;
  is_file: boolean;
  match_type: 'FileName' | 'DirectoryName' | 'FullPath';
  score: bigint | number;
};

export type PluginMentionLike = {
  name: string;
  display_name?: string | null;
  description?: string | null;
  skills_count: number;
  mcp_count: number;
  roles: string[];
};

export type SkillMentionLike = {
  id: string;
  name: string;
  plugin_name: string;
  description?: string | null;
};

export type SearchResultItemLike =
  | {
      type: 'plugin';
      plugin: PluginMentionLike;
    }
  | {
      type: 'skill';
      skill: SkillMentionLike;
    }
  | {
      type: 'tag';
      tag: FileTagLike;
    }
  | {
      type: 'file';
      file: FileResultLike;
    };

export type RepoLike = {
  id: string;
  name: string;
  display_name?: string | null;
};

type ChooseRepoResult = {
  repoId: string;
};

type SearchArgs = {
  repoIds?: string[];
};

type MentionTab = 'all' | 'plugins' | 'skills' | 'tags' | 'files';

type FileTagTypeaheadPluginProps = {
  repoIds?: string[];
  diffPaths?: Set<string>;
  preferredRepoId?: string | null;
  setPreferredRepoId?: (repoId: string | null) => void;
  listRecentRepos?: () => Promise<RepoLike[]>;
  getRepoById?: (repoId: string) => Promise<RepoLike | null>;
  chooseRepo?: (repos: RepoLike[]) => Promise<ChooseRepoResult | undefined>;
  onCreateTag?: () => Promise<boolean>;
  searchTagsAndFiles?: (
    query: string,
    args: SearchArgs
  ) => Promise<SearchResultItemLike[]>;
  plugins?: PluginMentionLike[];
  skills?: SkillMentionLike[];
};

class FileTagOption extends MenuOption {
  item: SearchResultItemLike;

  constructor(item: SearchResultItemLike) {
    const key =
      item.type === 'plugin'
        ? `plugin-${item.plugin.name}`
        : item.type === 'skill'
          ? `skill-${item.skill.id}`
          : item.type === 'tag'
            ? `tag-${item.tag.id}`
            : `file-${item.file.path}`;
    super(key);
    this.item = item;
  }
}

function getMatchingDiffFiles(
  query: string,
  diffPaths: Set<string>
): DiffFileResult[] {
  if (!query) return [];
  const lowerQuery = query.toLowerCase();
  return Array.from(diffPaths)
    .filter((path) => {
      const name = path.split('/').pop() || path;
      return (
        name.toLowerCase().includes(lowerQuery) ||
        path.toLowerCase().includes(lowerQuery)
      );
    })
    .map((path) => {
      const name = path.split('/').pop() || path;
      const nameMatches = name.toLowerCase().includes(lowerQuery);
      return {
        path,
        name,
        is_file: true,
        match_type: nameMatches ? ('FileName' as const) : ('FullPath' as const),
        // High score to rank diff files above server results.
        score: BigInt(Number.MAX_SAFE_INTEGER),
      };
    });
}

function getRepoDisplayName(repo: RepoLike): string {
  return repo.display_name || repo.name;
}

export function FileTagTypeaheadPlugin({
  repoIds,
  diffPaths,
  preferredRepoId,
  setPreferredRepoId,
  listRecentRepos,
  getRepoById,
  chooseRepo,
  onCreateTag,
  searchTagsAndFiles,
  plugins,
  skills,
}: FileTagTypeaheadPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [options, setOptions] = useState<FileTagOption[]>([]);
  const [activeTab, setActiveTab] = useState<MentionTab>('all');
  const [recentRepoCatalog, setRecentRepoCatalog] = useState<RepoLike[] | null>(
    null
  );
  const [preferredRepoName, setPreferredRepoName] = useState<string | null>(
    null
  );
  const [showMissingRepoState, setShowMissingRepoState] = useState(false);
  const [isChoosingRepo, setIsChoosingRepo] = useState(false);
  const { t } = useTranslation('common');
  const { setIsOpen } = useTypeaheadOpen();
  const searchRequestRef = useRef(0);
  const lastQueryRef = useRef<string | null>(null);

  const effectiveDiffPaths = useMemo(
    () => diffPaths ?? new Set<string>(),
    [diffPaths]
  );
  const usePreferenceRepoSelection = repoIds === undefined;
  const canManageRepoPreference =
    usePreferenceRepoSelection &&
    !!setPreferredRepoId &&
    !!listRecentRepos &&
    !!chooseRepo;

  const effectiveRepoIds = useMemo(() => {
    if (!usePreferenceRepoSelection) {
      return repoIds;
    }
    return preferredRepoId ? [preferredRepoId] : undefined;
  }, [preferredRepoId, repoIds, usePreferenceRepoSelection]);

  const canSearchFiles = Boolean(effectiveRepoIds && effectiveRepoIds.length);

  const loadRecentRepos = useCallback(
    async (force = false): Promise<RepoLike[]> => {
      if (!force && recentRepoCatalog !== null) {
        return recentRepoCatalog;
      }
      if (!listRecentRepos) {
        setRecentRepoCatalog([]);
        return [];
      }
      const repos = await listRecentRepos();
      setRecentRepoCatalog(repos);
      return repos;
    },
    [listRecentRepos, recentRepoCatalog]
  );

  const runSearch = useCallback(
    async (query: string, overrideRepoIds?: string[]) => {
      const requestId = ++searchRequestRef.current;
      const scopedRepoIds = overrideRepoIds ?? effectiveRepoIds;
      const fileSearchEnabled = Boolean(
        scopedRepoIds && scopedRepoIds.length > 0
      );

      const localFiles = fileSearchEnabled
        ? getMatchingDiffFiles(query, effectiveDiffPaths)
        : [];
      const localFilePaths = new Set(localFiles.map((f) => f.path));

      try {
        const serverResults = searchTagsAndFiles
          ? await searchTagsAndFiles(query, { repoIds: scopedRepoIds })
          : [];

        if (requestId !== searchRequestRef.current) {
          return;
        }

        const normalizedQuery = query.trim().toLowerCase();
        const pluginResults: SearchResultItemLike[] = (plugins ?? [])
          .filter((p) => {
            if (!normalizedQuery) return true;
            return (
              p.name.toLowerCase().includes(normalizedQuery) ||
              (p.display_name ?? '').toLowerCase().includes(normalizedQuery) ||
              (p.description ?? '').toLowerCase().includes(normalizedQuery)
            );
          })
          .slice(0, 8)
          .map((plugin) => ({ type: 'plugin' as const, plugin }));

        const skillResults: SearchResultItemLike[] = (skills ?? [])
          .filter((s) => {
            if (!normalizedQuery) return true;
            return (
              s.name.toLowerCase().includes(normalizedQuery) ||
              s.plugin_name.toLowerCase().includes(normalizedQuery) ||
              (s.description ?? '').toLowerCase().includes(normalizedQuery)
            );
          })
          .slice(0, 10)
          .map((skill) => ({ type: 'skill' as const, skill }));

        const tagResults = serverResults.filter((r) => r.type === 'tag');
        const serverFileResults = serverResults
          .filter((r) => r.type === 'file')
          .filter((r) => !localFilePaths.has(r.file.path));

        const limitedLocalFiles = localFiles.slice(0, MAX_FILE_RESULTS);
        const remainingSlots = MAX_FILE_RESULTS - limitedLocalFiles.length;
        const limitedServerFiles = serverFileResults.slice(0, remainingSlots);

        const mergedResults: SearchResultItemLike[] = [
          ...pluginResults,
          ...skillResults,
          ...tagResults,
          ...limitedLocalFiles.map((file) => ({
            type: 'file' as const,
            file,
          })),
          ...limitedServerFiles,
        ];

        setOptions(mergedResults.map((result) => new FileTagOption(result)));
      } catch (err) {
        if (requestId === searchRequestRef.current) {
          setOptions([]);
        }
        console.error('Failed to search tags/files', {
          requestId,
          query,
          err,
        });
      }
    },
    [effectiveDiffPaths, effectiveRepoIds, plugins, searchTagsAndFiles, skills]
  );

  useEffect(() => {
    if (!usePreferenceRepoSelection || !preferredRepoId || !listRecentRepos) {
      if (!preferredRepoId) {
        setPreferredRepoName(null);
      }
      return;
    }

    let canceled = false;
    void loadRecentRepos()
      .then(async (recentRepos) => {
        if (canceled) return;

        const matchingRecentRepo = recentRepos.find(
          (repo) => repo.id === preferredRepoId
        );
        if (matchingRecentRepo) {
          setPreferredRepoName(getRepoDisplayName(matchingRecentRepo));
          setShowMissingRepoState(false);
          return;
        }

        const existingRepo = getRepoById
          ? await getRepoById(preferredRepoId)
          : null;

        if (canceled) return;
        if (existingRepo) {
          setPreferredRepoName(getRepoDisplayName(existingRepo));
          setShowMissingRepoState(false);
          return;
        }

        setPreferredRepoName(null);
        setShowMissingRepoState(true);
        setPreferredRepoId?.(null);

        const queryToRefresh = lastQueryRef.current;
        if (queryToRefresh !== null) {
          void runSearch(queryToRefresh, []);
        }
      })
      .catch((err) => {
        console.error('Failed to load repos for file-search preference', err);
      });

    return () => {
      canceled = true;
    };
  }, [
    getRepoById,
    listRecentRepos,
    loadRecentRepos,
    preferredRepoId,
    runSearch,
    setPreferredRepoId,
    usePreferenceRepoSelection,
  ]);

  const handleChooseRepo = useCallback(async () => {
    if (!chooseRepo || !setPreferredRepoId) {
      return;
    }

    setIsChoosingRepo(true);
    try {
      const repos = await loadRecentRepos(true);
      const repoResult = await chooseRepo(repos);

      if (!repoResult?.repoId) {
        return;
      }

      const selectedRepo = repos.find((repo) => repo.id === repoResult.repoId);
      if (!selectedRepo) {
        return;
      }

      setPreferredRepoId(selectedRepo.id);
      setPreferredRepoName(getRepoDisplayName(selectedRepo));
      setShowMissingRepoState(false);

      const queryToRefresh = lastQueryRef.current;
      if (queryToRefresh !== null) {
        void runSearch(queryToRefresh, [selectedRepo.id]);
      }
    } catch (err) {
      console.error('Failed to choose repo for file search', err);
    } finally {
      setIsChoosingRepo(false);
    }
  }, [chooseRepo, loadRecentRepos, runSearch, setPreferredRepoId]);

  const closeTypeahead = useCallback(() => {
    editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown'));
  }, [editor]);

  const handleCreateTag = useCallback(async () => {
    closeTypeahead();
    if (!onCreateTag) {
      return;
    }

    try {
      const saved = await onCreateTag();
      if (saved) {
        const queryToRefresh = lastQueryRef.current;
        if (queryToRefresh !== null) {
          void runSearch(queryToRefresh);
        }
      }
    } catch {
      // User cancelled.
    }
  }, [closeTypeahead, onCreateTag, runSearch]);

  const onQueryChange = useCallback(
    (query: string | null) => {
      if (query === null) {
        setOptions([]);
        return;
      }

      lastQueryRef.current = query;
      void runSearch(query);
    },
    [runSearch]
  );

  const filteredOptions = useMemo(() => {
    if (activeTab === 'all') return options;
    return options.filter((opt) => {
      if (activeTab === 'plugins') return opt.item.type === 'plugin';
      if (activeTab === 'skills') return opt.item.type === 'skill';
      if (activeTab === 'tags') return opt.item.type === 'tag';
      return opt.item.type === 'file';
    });
  }, [activeTab, options]);

  return (
    <LexicalTypeaheadMenuPlugin<FileTagOption>
      commandPriority={COMMAND_PRIORITY_NORMAL}
      triggerFn={(text) => {
        const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
        if (!match) return null;
        const offset = match.index + match[0].indexOf('@');
        return {
          leadOffset: offset,
          matchingString: match[1],
          replaceableString: match[0].slice(match[0].indexOf('@')),
        };
      }}
      options={filteredOptions}
      onQueryChange={onQueryChange}
      onOpen={() => {
        setActiveTab('all');
        setIsOpen(true);
      }}
      onClose={() => setIsOpen(false)}
      onSelectOption={(option, nodeToReplace, closeMenu) => {
        editor.update(() => {
          if (!nodeToReplace) return;

          if (option.item.type === 'plugin') {
            const mention = `@[plugin:${option.item.plugin.name}]`;
            const pillNode = $createTextNode(mention);
            pillNode.toggleFormat('code');
            nodeToReplace.replace(pillNode);
            const spaceNode = $createTextNode(' ');
            pillNode.insertAfter(spaceNode);
            spaceNode.setFormat(0);
            spaceNode.select(1, 1);
          } else if (option.item.type === 'skill') {
            const mention = `@[skill:${option.item.skill.name}]`;
            const pillNode = $createTextNode(mention);
            pillNode.toggleFormat('code');
            nodeToReplace.replace(pillNode);
            const spaceNode = $createTextNode(' ');
            pillNode.insertAfter(spaceNode);
            spaceNode.setFormat(0);
            spaceNode.select(1, 1);
          } else if (option.item.type === 'tag') {
            const textToInsert = option.item.tag.content ?? '';
            const textNode = $createTextNode(textToInsert);
            nodeToReplace.replace(textNode);
            textNode.select(textToInsert.length, textToInsert.length);
          } else {
            const fileName = option.item.file.name ?? '';
            const fullPath = option.item.file.path ?? '';

            const fileNameNode = $createTextNode(fileName);
            fileNameNode.toggleFormat('code');
            nodeToReplace.replace(fileNameNode);

            const spaceNode = $createTextNode(' ');
            fileNameNode.insertAfter(spaceNode);
            spaceNode.setFormat(0);
            spaceNode.select(1, 1);

            const root = $getRoot();
            const children = root.getChildren();
            let pathAlreadyExists = false;

            for (const child of children) {
              if (!$isParagraphNode(child)) continue;

              const textNodes = child.getAllTextNodes();
              for (const textNode of textNodes) {
                if (
                  textNode.hasFormat('code') &&
                  textNode.getTextContent() === fullPath
                ) {
                  pathAlreadyExists = true;
                  break;
                }
              }
              if (pathAlreadyExists) break;
            }

            if (!pathAlreadyExists && fullPath) {
              const pathParagraph = $createParagraphNode();
              const pathNode = $createTextNode(fullPath);
              pathNode.toggleFormat('code');
              pathParagraph.append(pathNode);

              const trailingSpace = $createTextNode(' ');
              pathParagraph.append(trailingSpace);
              trailingSpace.setFormat(0);

              root.append(pathParagraph);
            }
          }
        });

        closeMenu();
      }}
      menuRenderFn={(
        anchorRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) => {
        if (!anchorRef.current) return null;

        const allPluginsCount = options.filter(
          (r) => r.item.type === 'plugin'
        ).length;
        const allSkillsCount = options.filter(
          (r) => r.item.type === 'skill'
        ).length;
        const allTagsCount = options.filter(
          (r) => r.item.type === 'tag'
        ).length;
        const allFilesCount = options.filter(
          (r) => r.item.type === 'file'
        ).length;

        const pluginResults = filteredOptions.filter(
          (r) => r.item.type === 'plugin'
        );
        const skillResults = filteredOptions.filter(
          (r) => r.item.type === 'skill'
        );
        const tagResults = filteredOptions.filter((r) => r.item.type === 'tag');
        const fileResults = filteredOptions.filter(
          (r) => r.item.type === 'file'
        );

        const showChooseRepoControl =
          canManageRepoPreference && !canSearchFiles;
        const showSelectedRepoState = canManageRepoPreference && canSearchFiles;
        const showTagsSection = activeTab === 'all' || activeTab === 'tags';
        const showFilesSection =
          (activeTab === 'all' || activeTab === 'files') &&
          (fileResults.length > 0 ||
            showChooseRepoControl ||
            showSelectedRepoState ||
            showMissingRepoState);
        const hasSearchResults =
          pluginResults.length > 0 ||
          skillResults.length > 0 ||
          tagResults.length > 0 ||
          fileResults.length > 0;
        const isPluginOrSkillTab =
          activeTab === 'plugins' || activeTab === 'skills';
        const showGlobalEmptyState =
          !isPluginOrSkillTab &&
          !hasSearchResults &&
          !showFilesSection &&
          !showTagsSection;
        const selectedRepoLabel = preferredRepoName ?? preferredRepoId;
        const repoCtaLabel = showSelectedRepoState
          ? t('typeahead.selectedRepo', {
              repoName: selectedRepoLabel,
            })
          : t('typeahead.chooseRepo');

        const tabs: Array<{ id: MentionTab; label: string; count: number }> = [
          { id: 'all', label: 'Tất cả', count: options.length },
          { id: 'plugins', label: 'Plugins', count: allPluginsCount },
          { id: 'skills', label: 'Skills', count: allSkillsCount },
          { id: 'tags', label: 'Tags', count: allTagsCount },
          { id: 'files', label: 'Files', count: allFilesCount },
        ];

        return createPortal(
          <TypeaheadMenu
            anchorEl={anchorRef.current}
            editorEl={editor.getRootElement()}
            onClickOutside={closeTypeahead}
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-base py-half overflow-x-auto">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setActiveTab(tab.id);
                      setHighlightedIndex(0);
                    }}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors',
                      isActive
                        ? 'bg-brand text-white'
                        : 'text-low hover:bg-secondary/70 hover:text-normal'
                    )}
                  >
                    <span>{tab.label}</span>
                    {tab.count > 0 && (
                      <span
                        className={cn(
                          'text-[10px] tabular-nums',
                          isActive ? 'text-white/80' : 'text-low/80'
                        )}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {showGlobalEmptyState ? (
              <TypeaheadMenu.Empty>
                {t('typeahead.noTagsOrFiles')}
              </TypeaheadMenu.Empty>
            ) : (
              <TypeaheadMenu.ScrollArea>
                {pluginResults.length > 0 && (
                  <>
                    <TypeaheadMenu.SectionHeader>
                      Plugins
                    </TypeaheadMenu.SectionHeader>
                    {pluginResults.map((option) => {
                      if (option.item.type !== 'plugin') return null;
                      const index = filteredOptions.indexOf(option);
                      const plugin = option.item.plugin;
                      const summaryParts: string[] = [];
                      if (plugin.skills_count > 0) {
                        summaryParts.push(`${plugin.skills_count} skills`);
                      }
                      if (plugin.mcp_count > 0) {
                        summaryParts.push(`${plugin.mcp_count} MCP`);
                      }
                      return (
                        <TypeaheadMenu.Item
                          key={option.key}
                          isSelected={index === selectedIndex}
                          index={index}
                          setHighlightedIndex={setHighlightedIndex}
                          onClick={() => selectOptionAndCleanUp(option)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-half font-medium min-w-0">
                              <PuzzlePieceIcon
                                className="size-icon-xs shrink-0 text-brand"
                                weight="bold"
                              />
                              <span className="truncate">
                                {plugin.display_name || plugin.name}
                              </span>
                              <span className="text-[11px] font-normal text-low truncate">
                                @{plugin.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {plugin.roles.length > 0 && (
                                <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                                  {plugin.roles
                                    .map((r) =>
                                      r === 'crew'
                                        ? 'Crew'
                                        : r === 'captain'
                                          ? 'Captain'
                                          : r
                                    )
                                    .join(' · ')}
                                </span>
                              )}
                            </div>
                          </div>
                          {(plugin.description || summaryParts.length > 0) && (
                            <div className="text-xs text-low truncate">
                              {summaryParts.length > 0
                                ? `${summaryParts.join(' · ')}${plugin.description ? ` — ${plugin.description}` : ''}`
                                : plugin.description}
                            </div>
                          )}
                        </TypeaheadMenu.Item>
                      );
                    })}
                  </>
                )}

                {skillResults.length > 0 && (
                  <>
                    {pluginResults.length > 0 && <TypeaheadMenu.Divider />}
                    <TypeaheadMenu.SectionHeader>
                      Skills
                    </TypeaheadMenu.SectionHeader>
                    {skillResults.map((option) => {
                      if (option.item.type !== 'skill') return null;
                      const index = filteredOptions.indexOf(option);
                      const skill = option.item.skill;
                      return (
                        <TypeaheadMenu.Item
                          key={option.key}
                          isSelected={index === selectedIndex}
                          index={index}
                          setHighlightedIndex={setHighlightedIndex}
                          onClick={() => selectOptionAndCleanUp(option)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-half font-medium min-w-0">
                              <SparkleIcon
                                className="size-icon-xs shrink-0 text-sky-400"
                                weight="bold"
                              />
                              <span className="truncate">{skill.name}</span>
                            </div>
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-low shrink-0">
                              {skill.plugin_name}
                            </span>
                          </div>
                          {skill.description && (
                            <div className="text-xs text-low truncate">
                              {skill.description}
                            </div>
                          )}
                        </TypeaheadMenu.Item>
                      );
                    })}
                  </>
                )}

                {showTagsSection && (
                  <>
                    {(pluginResults.length > 0 || skillResults.length > 0) && (
                      <TypeaheadMenu.Divider />
                    )}
                    <TypeaheadMenu.SectionHeader>
                      {t('typeahead.tags')}
                    </TypeaheadMenu.SectionHeader>
                    <TypeaheadMenu.Action onClick={() => void handleCreateTag()}>
                      <span className="flex items-center gap-half">
                        <PlusIcon className="size-icon-xs" weight="bold" />
                        <span>{t('typeahead.createTag')}</span>
                      </span>
                    </TypeaheadMenu.Action>

                    {tagResults.map((option) => {
                      if (option.item.type !== 'tag') return null;
                      const index = filteredOptions.indexOf(option);
                      const tag = option.item.tag;
                      return (
                        <TypeaheadMenu.Item
                          key={option.key}
                          isSelected={index === selectedIndex}
                          index={index}
                          setHighlightedIndex={setHighlightedIndex}
                          onClick={() => selectOptionAndCleanUp(option)}
                        >
                          <div className="flex items-center gap-half font-medium">
                            <TagIcon
                              className="size-icon-xs shrink-0"
                              weight="bold"
                            />
                            <span>@{tag.tag_name}</span>
                          </div>
                          {tag.content && (
                            <div className="text-xs text-low truncate">
                              {tag.content.slice(0, 60)}
                              {tag.content.length > 60 ? '...' : ''}
                            </div>
                          )}
                        </TypeaheadMenu.Item>
                      );
                    })}
                  </>
                )}

                {showFilesSection && (
                  <>
                    {(pluginResults.length > 0 ||
                      skillResults.length > 0 ||
                      showTagsSection) && <TypeaheadMenu.Divider />}
                    <TypeaheadMenu.SectionHeader>
                      {t('typeahead.files')}
                    </TypeaheadMenu.SectionHeader>
                    {showMissingRepoState && (
                      <TypeaheadMenu.Empty>
                        {t('typeahead.missingRepo')}
                      </TypeaheadMenu.Empty>
                    )}
                    {(showChooseRepoControl || showSelectedRepoState) && (
                      <TypeaheadMenu.Action
                        onClick={() => {
                          void handleChooseRepo();
                        }}
                        disabled={isChoosingRepo}
                      >
                        <span className="flex items-center gap-half">
                          <GearIcon className="size-icon-xs" weight="bold" />
                          <span>{repoCtaLabel}</span>
                        </span>
                      </TypeaheadMenu.Action>
                    )}
                    {fileResults.map((option) => {
                      if (option.item.type !== 'file') return null;
                      const index = filteredOptions.indexOf(option);
                      const file = option.item.file;
                      return (
                        <TypeaheadMenu.Item
                          key={option.key}
                          isSelected={index === selectedIndex}
                          index={index}
                          setHighlightedIndex={setHighlightedIndex}
                          onClick={() => selectOptionAndCleanUp(option)}
                        >
                          <div className="flex items-center gap-half font-medium truncate">
                            <FileTextIcon
                              className="size-icon-xs shrink-0"
                              weight="bold"
                            />
                            <span>{file.name}</span>
                          </div>
                          <div className="text-xs text-low truncate">
                            {file.path}
                          </div>
                        </TypeaheadMenu.Item>
                      );
                    })}
                  </>
                )}

                {!hasSearchResults &&
                  !showFilesSection &&
                  (activeTab === 'plugins' || activeTab === 'skills') && (
                    <TypeaheadMenu.Empty>
                      Không có {activeTab === 'plugins' ? 'plugin' : 'skill'} phù hợp
                    </TypeaheadMenu.Empty>
                  )}
              </TypeaheadMenu.ScrollArea>
            )}
          </TypeaheadMenu>,
          document.body
        );
      }}
    />
  );
}
