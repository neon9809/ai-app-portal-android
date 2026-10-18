/**
 * 端侧原子能力清单。
 *
 * 这些能力来自平台连接器（原子能力，transport = atomic_device_mcp）：
 * 页面不能直连设备，只能经宿主调用壳提供的 window.mcp.callTool。
 * 本文件只做「能力名 → 权限组 / 连接器」的映射与说明，供沙箱、生成器、详情页共用。
 *
 * 如实说明边界：
 *  - 「麦克风与录音」「摄像头硬件能力」是打开系统里的「快记」/ 相机应用，
 *    录音与照片留在那些应用里，不会进入本工具；
 *  - 「网络设置」「蓝牙链接」「音频输出与路由」修改的是系统设置；
 *  - 上传能力会把文件传到服务端，必须单独授权。
 */

import type { AppCapabilityKey, DeviceAbilityGroup } from './types'

export interface DeviceAbilityMeta {
  /** 调用前需要授权的权限组 */
  capability: AppCapabilityKey
  /** 提供该能力的连接器 ID（用于失败日志定位） */
  connector: string
}

/** 能力名 → 权限组 / 连接器。能力名必须与连接器回执完全一致，不得自己编造 */
export const DEVICE_ABILITIES: Record<string, DeviceAbilityMeta> = {
  // 定位（两个连接器提供同一能力）
  get_current_location: { capability: 'location', connector: 'ic_atomic_990007' },

  // 通用原子能力
  open_app_by_package: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  open_app_by_name: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  check_app_installed_by_name: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  common_ability_get_app_list: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  common_ability_get_app_count: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  open_url_with_browser: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  common_ability_get_screen_size: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  show_notify_by_info: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  show_widget_by_package_class: { capability: 'deviceApps', connector: 'ic_atomic_472' },
  common_ability_clipboard_text: { capability: 'clipboard', connector: 'ic_atomic_472' },

  // 上传
  batch_file_upload: { capability: 'deviceUpload', connector: 'ic_atomic_472' },
  batch_file_upload_return_all: { capability: 'deviceUpload', connector: 'ic_atomic_472' },
  batch_file_upload_all_progress: { capability: 'deviceUpload', connector: 'ic_atomic_472' },

  // 语音播报 / 震动
  speak_text: { capability: 'deviceSpeech', connector: 'ic_atomic_990004' },
  stop_speak_text: { capability: 'deviceSpeech', connector: 'ic_atomic_990004' },
  start_vibration: { capability: 'deviceHaptics', connector: 'ic_atomic_990012' },
  stop_vibration: { capability: 'deviceHaptics', connector: 'ic_atomic_990012' },

  // 系统设置
  settings_bluetooth_switch: { capability: 'deviceSystem', connector: 'ic_atomic_990015' },
  settings_get_bluetooth_state: { capability: 'deviceSystem', connector: 'ic_atomic_990015' },
  connectivitysettings_open_settings_bluetooth_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_990015',
  },
  settings_screen_lock_sound_switch: { capability: 'deviceSystem', connector: 'ic_atomic_990004' },
  settings_get_screen_lock_sound_state: { capability: 'deviceSystem', connector: 'ic_atomic_990004' },
  settings_set_media_sound: { capability: 'deviceSystem', connector: 'ic_atomic_990004' },
  dialer_settings_enable_incoming_flip_silent: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_990004',
  },
  connectivitysettings_open_settings_wifi_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_advanced_wifi_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_wifi_info_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_wifi_p_2_p_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_saved_access_points_wifi_settings: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_wifi_display_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_tether_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_vpn_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },
  connectivitysettings_open_settings_mobile_network_settings_activity: {
    capability: 'deviceSystem',
    connector: 'ic_atomic_495',
  },

  // 快记录音
  lite_recorder_open_recording: { capability: 'deviceRecorder', connector: 'ic_atomic_990003' },
  lite_recorder_stop_recording: { capability: 'deviceRecorder', connector: 'ic_atomic_990003' },
  lite_recorder_pause_recording: { capability: 'deviceRecorder', connector: 'ic_atomic_990003' },
  lite_recorder_resume_recording: { capability: 'deviceRecorder', connector: 'ic_atomic_990003' },

  // 相机硬件模式
  camera_open_beauty_mode: { capability: 'deviceCameraModes', connector: 'ic_atomic_990002' },
  camera_open_selfie_mode: { capability: 'deviceCameraModes', connector: 'ic_atomic_990002' },

  // 天气
  get_weather: { capability: 'deviceWeather', connector: 'ic_atomic_503' },
  weather_get_current_location_weather: {
    capability: 'deviceWeather',
    connector: 'ic_atomic_491',
  },

  // 文件管理
  filemanager_get_file_path: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_file_size: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_file_create_time: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_file_update_time: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_file_detail: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_create_folder: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_create_file: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_search_file: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_move_file: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_apk_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_compress_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_document_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_voice_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_video_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_download_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_weixin_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_browser_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_bluetooth_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_ringtone_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_screenshot_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_get_screen_recording_file_list: {
    capability: 'deviceFiles',
    connector: 'ic_atomic_468',
  },
  filemanager_get_garbage_file_list: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_edit_folder_name: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
  filemanager_edit_file_name: { capability: 'deviceFiles', connector: 'ic_atomic_468' },
}

/** 详情页与授权弹窗里的展示顺序 */
export const DEVICE_GROUP_ORDER: DeviceAbilityGroup[] = [
  'deviceApps',
  'deviceFiles',
  'deviceUpload',
  'deviceHaptics',
  'deviceSpeech',
  'deviceSystem',
  'deviceRecorder',
  'deviceCameraModes',
  'deviceWeather',
]

export interface DeviceGroupMeta {
  /** 权限列表里的短标题 */
  title: string
  /** 授权弹窗里的白话说明（必须如实写明边界） */
  description: string
  /** 生成器 prompt 里的能力用法 */
  prompt: string
}

export const DEVICE_GROUPS: Record<DeviceAbilityGroup, DeviceGroupMeta> = {
  deviceApps: {
    title: '打开其它应用',
    description:
      '这个工具可以查看你装了哪些应用、按名字或包名打开其它应用、在浏览器里打开网页、发通知，以及读取屏幕尺寸。',
    prompt:
      '打开 / 查询其它应用（无需接口密钥）：open_app_by_name({ appName })、open_app_by_package({ packageName })、check_app_installed_by_name({ appName })、common_ability_get_app_list()、common_ability_get_app_count()、open_url_with_browser({ url })、common_ability_get_screen_size()。show_notify_by_info 参数复杂（需要 intent / icon），不推荐。',
  },
  deviceFiles: {
    title: '管理本机文件',
    description:
      '这个工具可以在本机文件里搜索、列出、创建、移动、重命名文件和文件夹，也能读取回收站列表。它不会上传文件。',
    prompt:
      '文件管理：filemanager_search_file({ keywords }) 返回 [{ path, mIsDir }]；filemanager_get_document_file_list() / filemanager_get_download_file_list() / filemanager_get_video_file_list({ file_uri }) / filemanager_get_screenshot_file_list() 等分类列表；filemanager_get_file_detail({ file_uri })、filemanager_get_file_path / _size / _create_time / _update_time、filemanager_create_file({ fileName, folderPath? })、filemanager_create_folder({ folderName })、filemanager_move_file({ srcPath, desPath })、filemanager_edit_file_name({ file_uri, newName })、filemanager_edit_folder_name({ file_uri, newName })、filemanager_get_garbage_file_list()。路径支持绝对路径 / file:// / content://。',
  },
  deviceUpload: {
    title: '上传文件',
    description:
      '这个工具会把本机文件上传到它声明的服务端。上传前请确认文件内容可以外传。',
    prompt:
      '上传本机文件到服务端：batch_file_upload({ files }) 发起批量上传；batch_file_upload_return_all({ files }) 返回全部结果（structuredContent.uploaded[].url）；batch_file_upload_all_progress({ files }) 带进度。files 是文件 URI 列表，来自文件选择或文件管理。',
  },
  deviceHaptics: {
    title: '震动反馈',
    description: '这个工具会让手机震动，用来做点击或计时提醒。',
    prompt: '震动：start_vibration({ duration_ms, amplitude? })，取消 stop_vibration()。',
  },
  deviceSpeech: {
    title: '语音播报',
    description:
      '这个工具会把文字用系统语音读出来。播报会打断正在播放的音乐或视频。',
    prompt: '语音播报：speak_text({ text })，停止 stop_speak_text()。',
  },
  deviceSystem: {
    title: '修改系统设置',
    description:
      '这个工具可以打开系统的网络设置页面，并修改蓝牙开关、媒体音量、锁屏提示音、来电翻转静音等设置。',
    prompt:
      '系统设置：settings_bluetooth_switch({ openState })、settings_get_bluetooth_state()、settings_set_media_sound({ newValue: "50" })、settings_screen_lock_sound_switch({ openState })、settings_get_screen_lock_sound_state()、dialer_settings_enable_incoming_flip_silent({ enable })，以及打开设置页：connectivitysettings_open_settings_wifi_settings_activity()、..._advanced_wifi_settings_activity()、..._wifi_info_settings_activity()、..._saved_access_points_wifi_settings()、..._tether_settings_activity()、..._vpn_settings_activity()、..._mobile_network_settings_activity()、..._wifi_display_settings_activity()、..._bluetooth_settings_activity()。',
  },
  deviceRecorder: {
    title: '用快记录音',
    description:
      '这个工具会打开系统里的「快记」应用开始、暂停或结束录音。录音文件保存在快记里，不会进入这个工具。',
    prompt:
      '打开「快记」录音：lite_recorder_open_recording()、lite_recorder_pause_recording()、lite_recorder_resume_recording()、lite_recorder_stop_recording()。录音保存在快记里，本工具拿不到音频内容，不能做转写。',
  },
  deviceCameraModes: {
    title: '相机模式',
    description:
      '这个工具会打开系统相机，并切换到美颜或自拍模式。它只打开相机，不会替你拍照。',
    prompt:
      '打开系统相机模式：camera_open_beauty_mode()、camera_open_selfie_mode()。只打开相机，不拍照；需要拍照请用 portal.camera.capture。',
  },
  deviceWeather: {
    title: '查询天气',
    description:
      '这个工具会向天气服务查询你指定城市或当前所在地的天气。按当前位置查询时会读取定位。',
    prompt:
      '天气：按城市 get_weather({ province, city, area?, startDate?, endDate?, type?: "by_date" | "by_hour", startHour? })；按当前位置 weather_get_current_location_weather({ startDate?, endDate?, type?, startHour? })。返回 structuredContent.value（daily / hourly / realtime / alerts）。',
  },
}

/** 能力名对应的权限键；未知能力返回 null */
export function capabilityOfDeviceAbility(name: string): AppCapabilityKey | null {
  return DEVICE_ABILITIES[name]?.capability ?? null
}

/** 能力名对应的连接器 ID（诊断日志用）；未知能力返回 null */
export function connectorOfDeviceAbility(name: string): string | null {
  return DEVICE_ABILITIES[name]?.connector ?? null
}

export function isDeviceGroup(value: string): value is DeviceAbilityGroup {
  return Object.prototype.hasOwnProperty.call(DEVICE_GROUPS, value)
}

/** 应用是否声明了某个端侧能力组 */
export function declaresDeviceGroup(
  groups: DeviceAbilityGroup[] | undefined,
  group: DeviceAbilityGroup,
): boolean {
  return Array.isArray(groups) && groups.includes(group)
}
