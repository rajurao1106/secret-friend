import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:secret_friend/core/network/secret_friend_api.dart';

class MediaUploadService {
  MediaUploadService(this.api);

  final SecretFriendApi api;
  final Dio _cloudinaryDio = Dio();

  static const _mimeTypes = <String, String>{
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'zip': 'application/zip',
  };

  Future<String> uploadChatAttachment({
    required PlatformFile file,
    required String conversationId,
  }) async {
    final bytes = await file.readAsBytes();
    final extension = file.extension?.toLowerCase();
    final mime = extension == null ? null : _mimeTypes[extension];
    if (mime == null) {
      throw const FormatException('This file type is not supported.');
    }

    final reservationResponse = await api.request<Map<String, dynamic>>(
      '/media/presign',
      method: 'POST',
      data: {
        'kind': 'chat',
        'mime': mime,
        'size': bytes.length,
        'conversationId': conversationId,
      },
    );
    final reservation = reservationResponse.data;
    final uploadUrl = reservation?['uploadUrl'];
    final uploadId = reservation?['uploadId'];
    final fields = reservation?['fields'];
    if (uploadUrl is! String ||
        uploadId is! String ||
        fields is! Map<String, dynamic>) {
      throw const FormatException(
        'The server returned invalid upload details.',
      );
    }

    final formFields = <String, dynamic>{...fields};
    formFields['file'] = MultipartFile.fromBytes(bytes, filename: file.name);
    await _cloudinaryDio.post<dynamic>(
      uploadUrl,
      data: FormData.fromMap(formFields),
      options: Options(contentType: Headers.multipartFormDataContentType),
    );

    final confirmation = await api.request<Map<String, dynamic>>(
      '/media/confirm',
      method: 'POST',
      data: {'uploadId': uploadId},
    );
    final mediaId = confirmation.data?['id'];
    if (mediaId is! String) {
      throw const FormatException(
        'The server did not confirm the uploaded file.',
      );
    }
    return mediaId;
  }

  String? mimeForExtension(String extension) => _mimeTypes[extension];
}
