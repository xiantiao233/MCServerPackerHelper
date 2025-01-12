import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let settings: any = null; // 全局变量保存配置
let settingsFilePath: string | null = null;

export function activate(context: vscode.ExtensionContext) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('请打开一个工作区以使用此扩展');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    settingsFilePath = path.join(rootPath, 'mcp.build.setting.json');

    // 注册 mcp init 命令
    const initCommand = vscode.commands.registerCommand('mcserverpackerhelper.init', () => {
        if (!fs.existsSync(settingsFilePath!)) {
            vscode.window.showErrorMessage('未找到 mcp.build.setting.json 文件，请确保文件存在');
            return;
        }
        loadSettings();
        vscode.window.showInformationMessage('MCP 配置加载成功');
    });

    context.subscriptions.push(initCommand);

    // 监视配置文件的更改
    const fileWatcher = vscode.workspace.createFileSystemWatcher(settingsFilePath!);
    fileWatcher.onDidChange(() => loadSettingsAndNotify('MCP 配置已更新并重新加载'));
    fileWatcher.onDidCreate(() => loadSettingsAndNotify('MCP 配置文件已创建并加载'));
    fileWatcher.onDidDelete(() => handleFileDelete());
    context.subscriptions.push(fileWatcher);

    // 注册补全提供器
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file' },
        {
            provideCompletionItems(document, position, token, context) {
                if (!isValidFile(document.fileName)) {return;}

                const line = document.lineAt(position).text;
                const match = line.match(/\$\((mcp\.[\s\S]*)\)$/); // 匹配$(mcp.*)

                if (!match) {return;}

                const keyPath = match[1].split('.').slice(1);
                keyPath.pop(); // 删除最后一个部分

                const keys = getNestedKeys(settings?.placeholder?.data, keyPath);

                return Object.keys(keys).map(key => {
                    const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
                    item.documentation = `子键: ${key}`;
                    return item;
                });
            }
        },
        '.'
    );

    context.subscriptions.push(completionProvider);

    // 注册诊断错误提示
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('mcpErrors');
    context.subscriptions.push(diagnosticCollection);

    vscode.workspace.onDidChangeTextDocument(event => {
        const document = event.document;
        const diagnostics: vscode.Diagnostic[] = [];

        if (!settings || !isValidFile(document.fileName)) {return;}

        const regex = /\$\((mcp\.[\w\.\-\;\'\,\.\/\:\"\|\<\>\?\\\[\]\{\}\!\@\#\$\%\^\&\*\_\=\+\`\~\ ]*)\)/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(document.getText())) !== null) {
            const keyPath = match[1].split('.').slice(1);
            let currentData = settings.placeholder?.data;

            for (const key of keyPath) {
                if (!currentData || !currentData[key]) {
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(startPos, endPos),
                        `键 "${key}" 不存在`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostics.push(diagnostic);
                    break;
                }
                currentData = currentData[key];
            }
        }

        diagnosticCollection.set(document.uri, diagnostics);
    });

    // 注册 hover 提供者
    const hoverProvider = vscode.languages.registerHoverProvider(
        { scheme: 'file', pattern: '**/*.*' },
        {
            provideHover(document, position) {
                const wordRange = document.getWordRangeAtPosition(position, /\$\((mcp\.[\s\S]*)\)$/);
                if (!wordRange) {return;}

                const key = document.getText(wordRange).match(/\$\((mcp\.[\s\S]*)\)$/)?.[1].replaceAll("mcp.", "");
                if (!key) {return;}

                let hoverMessage = '';
				let split = key.split(".");
				const value = getNestedKeys(settings.placeholder.data, split);
                hoverMessage = `${JSON.stringify(value)}`;

                return new vscode.Hover(hoverMessage);
            }
        }
    );

    context.subscriptions.push(hoverProvider);
}

// 加载配置文件
function loadSettings() {
    if (!settingsFilePath || !fs.existsSync(settingsFilePath)) {
        settings = null;
        vscode.window.showErrorMessage('mcp.build.setting.json 文件未找到');
        return;
    }

    try {
        const content = fs.readFileSync(settingsFilePath, 'utf-8');
        settings = JSON.parse(content);
    } catch (err) {
        vscode.window.showErrorMessage('mcp.build.setting.json 文件解析错误');
        settings = null;
    }
}

// 加载配置并通知用户
function loadSettingsAndNotify(message: string) {
    loadSettings();
    vscode.window.showInformationMessage(message);
}

// 删除配置文件时的处理
function handleFileDelete() {
    settings = null;
    vscode.window.showWarningMessage('MCP 配置文件已被删除，扩展功能可能无法正常运行');
}

// 检查文件是否符合后缀要求
function isValidFile(fileName: string): boolean {
    if (!settings) {return false;}
    const suffixes = settings?.placeholder?.suffixes || [];
    return suffixes.some((suffix: string) => fileName.endsWith(suffix));
}

// 获取嵌套数据的键
function getNestedKeys(data: any, path: string[]) {
    let currentData = data;
    for (const key of path) {
        if (!currentData || !currentData[key]) {
            console.error(`Path "${key}" does not exist in the data.`);
            return {};
        }
        currentData = currentData[key];
    }
    return currentData ? currentData : {};
}

export function deactivate() {}
