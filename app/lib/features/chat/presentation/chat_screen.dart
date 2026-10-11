import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:secret_friend/core/network/media_upload_service.dart';
import 'package:secret_friend/core/network/secret_friend_api.dart';
import 'package:secret_friend/core/session/session_controller.dart';
import 'package:url_launcher/url_launcher.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({required this.userId, required this.nickname, super.key});

  final String userId;
  final String nickname;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  final List<Map<String, dynamic>> _messages = [];
  SecretFriendApi? _api;
  Timer? _pollTimer;
  bool _polling = false;
  String? _conversationId;
  String? _error;
  bool _loading = true;
  bool _sending = false;
  bool _revealed = false;

  @override
  void initState() {
    super.initState();
    unawaited(_openConversation());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _openConversation() async {
    final api = ref.read(secretFriendApiProvider);
    _api = api;
    try {
      final conversationResponse = await api.request<Map<String, dynamic>>(
        '/conversations',
        method: 'POST',
        data: {'otherUserId': widget.userId},
      );
      final id = conversationResponse.data?['id'];
      if (id is! String) {
        throw const FormatException('Invalid conversation response');
      }
      _conversationId = id;

      final historyResponse = await api.request<Map<String, dynamic>>(
        '/conversations/$id/messages',
      );
      final profileResponse = await api.request<Map<String, dynamic>>(
        '/users/${widget.userId}',
      );
      final rawItems = historyResponse.data?['items'];
      if (rawItems is List) {
        _messages
          ..clear()
          ..addAll(rawItems.whereType<Map<String, dynamic>>());
      }
      _revealed =
          historyResponse.data?['revealed'] == true ||
          profileResponse.data?['revealed'] == true;
      await api.request<void>(
        '/conversations/$id/read',
        method: 'POST',
        data: <String, dynamic>{},
      );
      if (mounted) {
        setState(() => _loading = false);
        _scrollToBottom();
        _pollTimer = Timer.periodic(
          const Duration(seconds: 4),
          (_) => unawaited(_pollMessages()),
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = api.errorMessage(error);
          _loading = false;
        });
      }
    }
  }

  Future<void> _pollMessages() async {
    final api = _api;
    final conversationId = _conversationId;
    if (_polling || api == null || conversationId == null || !mounted) return;
    _polling = true;

    try {
      final latest = _messages.isEmpty ? null : _messages.last;
      final createdAt = latest?['createdAt'];
      final messageId = latest?['id'];
      final after = createdAt is String && messageId is String
          ? base64Url
                .encode(
                  utf8.encode(
                    jsonEncode({'createdAt': createdAt, 'id': messageId}),
                  ),
                )
                .replaceAll('=', '')
          : null;
      final response = await api.request<Map<String, dynamic>>(
        '/conversations/$conversationId/messages',
        queryParameters: {'after': ?after},
      );
      final rawItems = response.data?['items'];
      final previousCount = _messages.length;
      if (rawItems is List) {
        for (final message in rawItems.whereType<Map<String, dynamic>>()) {
          _handleIncoming(message);
        }
      }
      final isRevealed = response.data?['revealed'] == true;
      if (mounted && isRevealed != _revealed) {
        setState(() => _revealed = isRevealed);
      }
      if (_messages.length > previousCount) {
        await api.request<void>(
          '/conversations/$conversationId/read',
          method: 'POST',
          data: <String, dynamic>{},
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = api.errorMessage(error));
    } finally {
      _polling = false;
    }
  }

  void _handleIncoming(dynamic payload) {
    if (payload is! Map<String, dynamic>) return;
    final id = payload['id'];
    if (id is String && _messages.any((message) => message['id'] == id)) return;
    if (!mounted) return;
    setState(() {
      _messages.add(payload);
      _error = null;
    });
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage() async {
    final body = _messageController.text.trim();
    final conversationId = _conversationId;
    final api = _api;
    if (body.isEmpty || api == null || conversationId == null) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final response = await api.request<Map<String, dynamic>>(
        '/conversations/$conversationId/messages',
        method: 'POST',
        data: {'type': 'text', 'body': body},
      );
      _messageController.clear();
      final message = response.data;
      if (message != null) _handleIncoming(message);
    } catch (error) {
      if (mounted) setState(() => _error = api.errorMessage(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _requestReveal() async {
    final id = _conversationId;
    final api = _api;
    if (id == null || api == null) return;
    try {
      await api.request<void>(
        '/conversations/$id/reveal-request',
        method: 'POST',
        data: <String, dynamic>{},
      );
      if (mounted) {
        setState(
          () => _error = 'Reveal request sent. You both need five messages before profiles unlock.',
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = api.errorMessage(error));
      }
    }
  }

  Future<void> _pickAndSendAttachment() async {
    if (!_revealed) {
      setState(() => _error = 'Media sharing unlocks after a mutual reveal.');
      return;
    }
    final conversationId = _conversationId;
    final api = _api;
    if (conversationId == null || api == null) {
      setState(() => _error = 'Chat is not ready. Please try again.');
      return;
    }
    try {
      final files = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: const [
          'jpg',
          'jpeg',
          'png',
          'webp',
          'pdf',
          'docx',
          'zip',
        ],
      );
      if (files.isEmpty) return;
      setState(() {
        _sending = true;
        _error = null;
      });
      final file = files.first;
      final mediaId = await MediaUploadService(api)
          .uploadChatAttachment(file: file, conversationId: conversationId);
      final extension = file.extension?.toLowerCase();
      final isImage = const {'jpg', 'jpeg', 'png', 'webp'}.contains(extension);
      final response = await api.request<Map<String, dynamic>>(
        '/conversations/$conversationId/messages',
        method: 'POST',
        data: {
          'type': isImage ? 'image' : 'file',
          'mediaId': mediaId,
          'body': file.name,
        },
      );
      final message = response.data;
      if (message != null) _handleIncoming(message);
    } catch (error) {
      if (mounted) setState(() => _error = api.errorMessage(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _openAttachment(String mediaId, {required bool isImage}) async {
    final api = _api;
    if (api == null) return;
    try {
      final response = await api.request<Map<String, dynamic>>(
        '/media/$mediaId/url',
      );
      final url = response.data?['url'];
      if (url is! String || !mounted) return;
      if (isImage) {
        await showDialog<void>(
          context: context,
          builder: (context) => Dialog(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Image.network(url, fit: BoxFit.contain),
            ),
          ),
        );
      } else if (!await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      )) {
        throw const FormatException('Could not open the shared file.');
      }
    } catch (error) {
      if (mounted) setState(() => _error = api.errorMessage(error));
    }
  }

  Future<void> _safetyAction(String action) async {
    final api = _api;
    if (api == null) return;
    try {
      if (action == 'block') {
        await api.request<void>('/blocks/${widget.userId}', method: 'POST');
        if (mounted) Navigator.of(context).pop();
      } else {
        await api.request<void>(
          '/reports',
          method: 'POST',
          data: {'userId': widget.userId, 'reason': 'Inappropriate behavior'},
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = api.errorMessage(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F2),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFAF8F2),
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.nickname, style: const TextStyle(fontSize: 16)),
            const Text(
              'Anonymous chat',
              style: TextStyle(fontSize: 11, color: Color(0xFF7D8981)),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Reveal friend',
            onPressed: _loading ? null : _requestReveal,
            icon: const Icon(Icons.auto_awesome_outlined),
          ),
          PopupMenuButton<String>(
            onSelected: _safetyAction,
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'report', child: Text('Report')),
              PopupMenuItem(value: 'block', child: Text('Block')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          const _ChatPrivacyBanner(),
          if (_error != null)
            MaterialBanner(
              content: Text(_error!),
              actions: [
                TextButton(
                  onPressed: () => setState(() => _error = null),
                  child: const Text('Dismiss'),
                ),
              ],
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: Text(
                        'Say hello. Your real details stay private until you both reveal.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Color(0xFF7D8981), height: 1.5),
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final message = _messages[index];
                      final mine =
                          message['senderId'] is String &&
                          message['senderId'] == _currentUserId;
                      final text = message['body'] as String? ?? '';
                      final mediaId = message['mediaId'] as String?;
                      return Align(
                        alignment: mine
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        child: Container(
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.sizeOf(context).width * .78,
                          ),
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 11,
                          ),
                          decoration: BoxDecoration(
                            color: mine
                                ? const Color(0xFF315C49)
                                : Colors.white,
                            borderRadius: BorderRadius.circular(17),
                            border: mine
                                ? null
                                : Border.all(color: const Color(0xFFE8E9E1)),
                          ),
                          child: mediaId == null
                              ? Text(
                                  text,
                                  style: TextStyle(
                                    color: mine
                                        ? Colors.white
                                        : const Color(0xFF20352D),
                                    height: 1.4,
                                  ),
                                )
                              : TextButton.icon(
                                  onPressed: () => _openAttachment(
                                    mediaId,
                                    isImage: message['type'] == 'image',
                                  ),
                                  icon: Icon(
                                    message['type'] == 'image'
                                        ? Icons.image_outlined
                                        : Icons.attach_file_rounded,
                                    color: mine
                                        ? Colors.white
                                        : const Color(0xFF315C49),
                                  ),
                                  label: Text(
                                    text.isEmpty ? 'Open attachment' : text,
                                    style: TextStyle(
                                      color: mine
                                          ? Colors.white
                                          : const Color(0xFF20352D),
                                    ),
                                  ),
                                ),
                        ),
                      );
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 2000,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: 'Write a kind message...',
                        counterText: '',
                        filled: true,
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 17,
                          vertical: 12,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(22),
                          borderSide: const BorderSide(
                            color: Color(0xFFE8E9E1),
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(22),
                          borderSide: const BorderSide(
                            color: Color(0xFFE8E9E1),
                          ),
                        ),
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: _revealed
                        ? 'Share image or file'
                        : 'Media unlocks after reveal',
                    onPressed: _sending || !_revealed
                        ? null
                        : _pickAndSendAttachment,
                    icon: const Icon(Icons.attach_file_rounded),
                  ),
                  const SizedBox(width: 9),
                  IconButton.filled(
                    onPressed: _sending ? null : _sendMessage,
                    icon: const Icon(Icons.arrow_upward_rounded),
                    style: IconButton.styleFrom(
                      backgroundColor: const Color(0xFF315C49),
                      foregroundColor: Colors.white,
                      minimumSize: const Size(48, 48),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String? get _currentUserId {
    final me = ref.read(sessionControllerProvider).me;
    return me?['id'] as String?;
  }
}

class _ChatPrivacyBanner extends StatelessWidget {
  const _ChatPrivacyBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(14, 3, 14, 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF0E9),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: [
          Icon(Icons.lock_outline_rounded, size: 15, color: Color(0xFF315C49)),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Keep it kind. Personal details are private until a mutual reveal.',
              style: TextStyle(
                color: Color(0xFF315C49),
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
