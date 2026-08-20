const desktopBridgeTools = new Set([
  'get_desktop_capabilities',
  'get_agent_status',
  'get_system_status',
  'get_system_info',
  'open_application',
  'close_application',
  'set_volume',
  'get_volume',
]);

export const mossTools = [
  { name: 'get_desktop_capabilities', description: 'Read live desktop-agent capability list', risk: 'low', authorization: 'L1', enabled: true, desktopTool: 'list_tools', parameters: {} },
  { name: 'get_system_status', description: '读取本机系统状态', risk: 'low', authorization: 'L1', enabled: true, desktopTool: 'get_system_info', parameters: {} },
  { name: 'get_system_info', description: '读取系统详细信息', risk: 'low', authorization: 'L1', enabled: true, desktopTool: 'get_system_info', parameters: {} },
  { name: 'get_agent_status', description: '读取桌面 Agent 连接状态', risk: 'low', authorization: 'L1', enabled: true, parameters: {} },
  { name: 'get_current_time', description: '读取当前系统时间', risk: 'low', authorization: 'L1', enabled: true, parameters: {} },
  { name: 'open_application', description: '打开指定应用', risk: 'low', authorization: 'L2', enabled: true, desktopTool: 'open_app', parameters: { app: 'string' } },
  { name: 'close_application', description: '关闭指定应用', risk: 'medium', authorization: 'L2', enabled: true, desktopTool: 'close_app', parameters: { app: 'string' } },
  { name: 'set_volume', description: '设置系统音量', risk: 'medium', authorization: 'L2', enabled: true, desktopTool: 'set_volume', parameters: { value: '0-100' } },
  { name: 'get_volume', description: '读取系统音量', risk: 'low', authorization: 'L1', enabled: true, desktopTool: 'get_system_info', parameters: {} },
  { name: 'take_screenshot', description: '截取当前屏幕', risk: 'medium', authorization: 'L2', enabled: false, desktopTool: 'take_screenshot', parameters: {} },
  { name: 'analyze_screen', description: '分析当前屏幕', risk: 'medium', authorization: 'L2', enabled: false, parameters: {} },
  { name: 'move_mouse', description: '移动鼠标', risk: 'medium', authorization: 'L2', enabled: false, desktopTool: 'move_mouse', parameters: {} },
  { name: 'click_mouse', description: '点击鼠标', risk: 'medium', authorization: 'L2', enabled: false, desktopTool: 'click_mouse', parameters: {} },
  { name: 'type_text', description: '键入文本', risk: 'high', authorization: 'L3', enabled: false, desktopTool: 'type_text', parameters: { text: 'string' } },
  { name: 'press_key', description: '按下键盘按键', risk: 'medium', authorization: 'L2', enabled: false, desktopTool: 'press_key', parameters: { key: 'string' } },
  { name: 'open_url', description: '打开网址', risk: 'high', authorization: 'L3', enabled: false, parameters: { url: 'string' } },
  { name: 'list_directory', description: '列出目录内容', risk: 'medium', authorization: 'L2', enabled: false, parameters: { path: 'string' } },
  { name: 'read_file', description: '读取文件', risk: 'medium', authorization: 'L2', enabled: false, parameters: { path: 'string' } },
  { name: 'write_file', description: '写入文件', risk: 'high', authorization: 'L3', enabled: false, parameters: { path: 'string', content: 'string' } },
  { name: 'delete_file', description: '删除文件', risk: 'high', authorization: 'L3', enabled: false, parameters: { path: 'string' } },
  { name: 'delete_directory', description: '删除目录', risk: 'high', authorization: 'L3', enabled: false, parameters: { path: 'string' } },
  { name: 'move_file', description: '移动文件', risk: 'high', authorization: 'L3', enabled: false, parameters: { from: 'string', to: 'string' } },
  { name: 'search_web', description: '联网检索', risk: 'medium', authorization: 'L2', enabled: false, parameters: { query: 'string' } },
  { name: 'send_message', description: '发送外部消息', risk: 'high', authorization: 'L3', enabled: false, parameters: { recipient: 'string', content: 'string' } },
  { name: 'email_send', description: '发送电子邮件', risk: 'high', authorization: 'L3', enabled: false, parameters: { to: 'string', subject: 'string', body: 'string' } },
];

export function getMossTool(name) {
  return mossTools.find((tool) => tool.name === name) || null;
}

export function toModelTools() {
  return mossTools.filter((tool) => tool.enabled).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(tool.parameters).map(([key, type]) => [key, { type: type === '0-100' ? 'number' : 'string' }])),
        required: Object.keys(tool.parameters),
      },
    },
  }));
}

export function needsDesktopBridge(tool) {
  return desktopBridgeTools.has(tool.name);
}
